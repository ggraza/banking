// Copyright (c) 2022, ALYF GmbH and contributors
// For license information, please see license.txt

frappe.ui.form.on('Banking Settings', {
	refresh: (frm) => {
		if (frm.doc.enabled) {
			frm.trigger("get_app_health");

			if (frm.doc.enable_klarna_kosma) {
				frm.add_custom_button(__('Link Bank and Accounts'), () => {
					frm.events.refresh_banks(frm);
				});

				frm.add_custom_button(__("Transactions"), () => {
					frm.events.sync_transactions(frm);
				}, __("Sync"));

				frm.add_custom_button(__("Older Transactions"), () => {
					frm.events.sync_transactions(frm, true);
				}, __("Sync"));
			}

			if (frm.doc.enable_ebics) {
				frm.add_custom_button(__("View EBICS Users"), () => {
					frappe.set_route("List", "EBICS User");
				});
			}

			if (frm.doc.customer_id && frm.doc.admin_endpoint && frm.doc.api_token) {
				frm.trigger("get_subscription");
			}

			frm.add_custom_button(__("Open Billing Portal"), async () => {
				const url = await frm.call({
					method: "get_customer_portal_url",
					freeze: true,
					freeze_message: __("Redirecting to Customer Portal ...")
				});
				if (url.message) {
					window.open(url.message, "_blank");
				}
			});
		} else {
			frm.page.add_inner_button(
				__("Signup for Banking"),
				() => {
					window.open(`${frm.doc.admin_endpoint}/banking-pricing`, "_blank");
				},
				null,
				"primary"
			);
		}

		frm.doc.reference_fields.map((field) => {
			set_field_options(frm, field.doctype, field.name);
		});
	},

	refresh_banks: (frm) => {
		let fields = [
			{
				fieldtype: "Link",
				options: "Company",
				label: __("Company"),
				fieldname: "company",
				reqd: 1
			},
			{
				fieldtype: "Date",
				label: __("Start Date"),
				fieldname: "start_date",
				description: __("Access and Sync bank records from this date."),
				default: frappe.datetime.month_start(),
				reqd: 1
			},
			{
				fieldtype: "HTML",
				fieldname: "info",
				options: get_info_html(
					__("Fetching older transactions will count against your limit in the current billing period.")
				)
			}
		];

		frappe.prompt(fields, (data) => {
			new KlarnaKosmaConnect({
				frm: frm,
				flow: "accounts",
				company: data.company,
				start_date: data.start_date || null
			});
		},
		__("Setup Bank & Accounts Sync"),
		__("Continue"));

	},

	sync_transactions: (frm, is_older=false) => {
		let fields = [
			{
				fieldtype: "Link",
				options: "Bank Account",
				label: __("Bank Account"),
				fieldname: "bank_account",
				reqd: 1,
				get_query: () => {
					return {
						filters: {
							"kosma_account_id": ["is", "set"],
						}
					};
				},
			},
			{
				fieldtype: "Section Break",
				fieldname: "sb_1",
			},
			{
				fieldtype: "Date",
				label: __("From Date"),
				fieldname: "from_date",
				reqd: 1
			},
			{
				fieldtype: "Column Break",
				fieldname: "cb_1",
			},
			{
				fieldtype: "Date",
				label: __("To Date"),
				fieldname: "to_date",
				reqd: 1
			},
			{
				fieldtype: "Section Break",
				fieldname: "sb_2",
				hide_border: 1
			},
			{
				fieldtype: "HTML",
				fieldname: "info"
			}
		];
		if (!is_older) {
			fields = fields.slice(0, 1);
		}

		let dialog = new frappe.ui.Dialog({
			title: is_older? __("Sync Older Transactions") : __("Sync Transactions"),
			fields: fields,
			primary_action_label: __("Sync"),
			primary_action: (data) => {
				dialog.hide();
				new KlarnaKosmaConnect({
					frm: frm,
					flow: "transactions",
					account: data.bank_account,
					from_date: is_older ? data.from_date : null,
					to_date: is_older ? data.to_date : null,
				});
			}
		});

		if (is_older) {
			dialog.get_field("info").$wrapper.html(
				get_info_html(
					__("Requires Bank Authentication.") +
					" " +
					__("Fetching older transactions will count against your limit in the current billing period.")
				)
			);
		}
		dialog.show();
	},

	get_subscription: async (frm) => {
		const data = await frm.call({
			method: "fetch_subscription_data",
		});

		if (data.message) {
			let subscription = data.message[0];

			frm.get_field("subscription").$wrapper.empty();
			frm.doc.subscription = "subscription";
			frm.get_field("subscription").$wrapper.html(`
				<div
					style="border: 1px solid var(--gray-300);
					border-radius: 4px;
					padding: 1rem;
					margin-bottom: 0.5rem;
				">
					<p style="font-weight: 700; font-size: 16px;">
						${ __("Subscription Details") }
					</p>
					<p>
						<b>${ __("Subscriber") }</b>:
						${subscription.full_name}
					</p>
					<p>
						<b>${ __("Status") }</b>:
						${subscription.subscription_status}
					</p>
					<p>
						<b>${ __("Transaction Limit") }</b>:
						${subscription.usage} (${__("Usage")}) / ${subscription.transaction_limit} (${__("Limit")})
					</p>
					<p>
						<b>${ __("Ebics Users") }</b>:
						${subscription.ebics_usage.used} (${__("Usage")}) / ${subscription.ebics_usage.allowed} (${__("Limit")})
					</p>
					<p>
						<b>${ __("Valid Till") }</b>:
						${frappe.format(subscription.plan_end_date, {"fieldtype": "Date"})}
					</p>
					<p>
						<b>${ __("Last Renewed On") }</b>:
						${frappe.format(subscription.last_paid_on, {"fieldtype": "Date"})}
					</p>
					<p>
						<a
							href="${subscription.billing_portal}"
							target="_blank"
							class="${subscription.billing_portal ? "" : "hidden"}"
						>
							<b>${__("Open Billing Portal")}</b>
							${frappe.utils.icon("link-url", "sm")}
						</a>
					</p>
				</div>
			`);

			if (subscription.billing_portal) {
				frm.remove_custom_button(__("Open Billing Portal"));
			}

			frm.refresh_field("subscription");
		}
	},

	get_app_health: async (frm) => {
		const data = await frm.call({
			method: "get_app_health",
		});

		let messages = data.message;
		if (messages) {
			if(messages["info"]) {
				frm.set_intro(messages["info"], "blue");
			}

			if (messages["warning"]) {
				$(frm.$wrapper.find(".form-layout")[0]).prepend(`
					<div class='form-message yellow'>
						${messages["warning"]}
					</div>
				`);
			}
		}
	},
});

frappe.ui.form.on('Banking Reference Mapping', {
	reference_fields_add: (frm, cdt, cdn) => {
		set_field_options(frm, cdt, cdn);
	},

	document_type: (frm, cdt, cdn) => {
		set_field_options(frm, cdt, cdn);
	}
});

function set_field_options(frm, cdt, cdn) {
	const doc = frappe.get_doc(cdt, cdn);
	const document_type = doc.document_type || "Sales Invoice";

	// set options for `field_name`
	frappe.model.with_doctype(document_type,  () => {
		const meta = frappe.get_meta(document_type);
		const fields = meta.fields.filter((field) => {
			return (
				["Link", "Data"].includes(field.fieldtype)
				&& field.is_virtual === 0
			);
		});

		frm.fields_dict.reference_fields.grid.update_docfield_property(
			"field_name",
			"options",
			fields.map((field) => {
				return {
					value: field.fieldname,
					label: __(field.label),
				}
			}).sort((a, b) => a.label.localeCompare(b.label))
		);
		frm.refresh_field("reference_fields");
	});
}


class KlarnaKosmaConnect {
	constructor(opts) {
		Object.assign(this, opts);
		this.use_flow_api = this.flow == "accounts" || (this.from_date && this.to_date);
		this.init_kosma_connect();
	}

	async init_kosma_connect () {
		if (this.use_flow_api) {
			// Renders XS2A App (which authenticates/gets consent)
			// and hands over control to server side for data fetch & business logic
			this.session = await this.get_client_token();
			this.render_xs2a_app();
		} else {
			// fetches data using the consent API without user intervention
			this.complete_transactions_flow();
		}
	}

	async get_client_token (){
		let session_data = await this.frm.call({
			method: "get_client_token",
			args: {
				current_flow: this.flow,
				account: this.account || null,
				from_date: this.flow === "accounts" ? this.start_date : this.from_date,
				to_date: this.to_date,
				company: this.company || null,
			},
			freeze: true,
			freeze_message: __("Please wait. Redirecting to Bank...")
		}).then(resp => resp.message);
		return session_data;
	}

	async render_xs2a_app() {
		// Render XS2A with client token
		await this.load_script();
		window.onXS2AReady = this.startKlarnaOpenBankingXS2AApp();
	}

	load_script() {
		return new Promise(function (resolve, reject) {
			const src = "https://x.klarnacdn.net/xs2a/app-launcher/v0/xs2a-app-launcher.js";

			if (document.querySelector('script[src="' + src + '"]')) {
				resolve();
				return;
			}

			const el = document.createElement('script');
			el.type = 'text/javascript';
			el.async = true;
			el.src = src;
			el.addEventListener('load', resolve);
			el.addEventListener('error', reject);
			el.addEventListener('abort', reject);
			document.head.appendChild(el);
		});
	}

	startKlarnaOpenBankingXS2AApp() {
		let me = this;
		try {
			window.XS2A.startFlow(
				me.session.client_token,
				{
					unfoldConsentDetails: true,
					onFinished: () => {
						window.XS2A.close();

						if (me.flow === "accounts")
							me.complete_accounts_flow();
						else
							me.complete_transactions_flow();
					},
					onError: error => {
						console.error('Something bad happened.', error);
						if (!error) {
							error = {"message": __("Something bad happened.")}
						}
						me.handle_failed_xs2a_flow(error);
					},
					onAbort: error => {
						console.error("Kosma Authentication Aborted", error);
						if (!error) {
							error = {"message": __("Kosma Authentication Aborted")}
						}
						me.handle_failed_xs2a_flow(error);					},
				}
			)
		} catch (e) {
			console.error(e);
		}
	}

	async complete_accounts_flow() {
			let flow_data = await this.fetch_accounts_data();
			if (!flow_data) return;

			flow_data = flow_data["message"];

			if (!flow_data["bank_data"] || !flow_data["accounts"]) {
				return;
			}

			const import_mapping = await this.select_iban_and_gl_account(flow_data.accounts.map((acc) => acc.iban));
			this.add_bank_account(
				flow_data["accounts"].find((acc) => acc.iban === import_mapping.iban),
				import_mapping.gl_account,
				flow_data["bank_data"]["bank_name"]
			);
	}

	async complete_transactions_flow()  {
		// Enqueue transactions fetch via Consent API
		await this.frm.call({
			method: "sync_transactions",
			args: {
				account: this.account,
				session_id_short: this.use_flow_api ? this.session.session_id_short : null
			},
			freeze: true,
			freeze_message: __("Please wait. Syncing Bank Transactions ...")
		});

	}

	async fetch_accounts_data() {
		try {
			const data = await this.frm.call({
				method: "fetch_accounts_and_bank",
				args: {
					session_id_short: this.session.session_id_short,
					company: this.company,
				},
				freeze: true,
				freeze_message: __("Please wait. Fetching Bank Acounts ...")
			});

			if (!data.message || data.exc) {
				frappe.throw(__("Failed to fetch Bank Accounts."));
			} else {
				return data;
			}
		} catch(e) {
			console.log(e);
		}
	}

	add_bank_account(bank_account, gl_account, bank_name) {
		try {
			this.frm.call({
				method: "add_bank_account",
				args: {
					account_data: bank_account,
					gl_account: gl_account,
					company: this.company,
					bank_name: bank_name,
				},
				freeze: true,
				freeze_message: __("Adding bank accounts ...")
			}).then((r) => {
				if (!r.exc) {
					frappe.show_alert({ message: __("Bank accounts added"), indicator: 'green' });
				}
			});
		} catch(e) {
			console.log(e);
		}
	}

	handle_failed_xs2a_flow(error) {
		try {
			frappe.call({
				method: "banking.klarna_kosma_integration.exception_handler.handle_ui_error",
				args: {
					error: error,
					session_id_short: this.session.session_id_short
				}
			}).then((r) => {
				if (!r.exc) {
					frappe.show_alert({ message: __("Banking Session Ended"), indicator: "red" });
				}
			});
		} catch(e) {
			console.log(e);
		}
	}

	/*
	 * Prompt the user to select an IBAN and the corresponding ERPNext GL Account.
	 */
	select_iban_and_gl_account(available_ibans) {
		return new Promise((resolve, reject) => {
			const dialog = frappe.prompt(
				[
					{
						fieldtype: "Select",
						label: __("IBAN"),
						fieldname: "iban",
						options: available_ibans,
						reqd: 1,
					},
					{
						fieldtype: "Link",
						label: __("Account"),
						fieldname: "gl_account",
						options: "Account",
						reqd: 1,
						get_query: () => {
							return {
								filters: {
									"company": this.company,
									"account_type": "Bank"
								}
							};
						}
					}
				],
				(data) => {
					resolve(data);
				},
				__("Select IBAN and corresponding ERPNext Account"),
			);
		});
	}
}


function get_info_html(message) {
	return `<div
		class="form-message blue"
		style="
			padding: var(--padding-sm) var(--padding-sm);
			background-color: var(--alert-bg-info);
		"
	>
		<span>${frappe.utils.icon("solid-info", "md")}</span>
		<span class="small" style="padding-left: var(--padding-xs)">
			${ message }
		</span>
	</div>`;
}
