import os

components_to_fix = {
    "App.tsx": ["SetupRedirect"],
    "ClientDetailPage.tsx": ["PaymentModal", "ClientInfoTab", "LedgerTab", "ChequesTab", "InvoicesTab", "LoyaltyTab"],
    "DebtAgeingPage.tsx": ["AmountCell"],
    "SettingsPage.tsx": ["Toast", "AgencesTab", "VersementsTab"],
    "AuditLogPage.tsx": ["AuditLogPage"],
    "SuppliersPage.tsx": ["SupplierFormModal"],
    "PurchaseOrderFormPage.tsx": ["SupplierSearchInput", "VariantSearchInput"],
    "PurchaseOrderDetailPage.tsx": ["VariantSearch", "LineResolutionRow", "ReceiveForm", "StatusActions"],
    "SupplierDetailPage.tsx": ["PaymentModal", "InfoTab", "OrdersTab", "InvoicesTab", "PaymentsTab"],
    "SupplierPayablesPage.tsx": ["AmountCell"],
    "CartonPanel.tsx": ["ProductSearch"],
    "SalesPage.tsx": ["CreateClientModal", "ClientSelector"],
    "ExchangeModal.tsx": ["ExchangeModal"],
    "ReconciliationPage.tsx": ["HistoryRow"],
    "AuthContext.tsx": ["AuthProvider"],
    "SetupPage.tsx": ["SetupPage"],
    "BranchContext.tsx": ["BranchProvider"],
    "LoyaltyPage.tsx": ["ProgramPanel", "AdjustModal", "AccountsPanel", "LoyaltyPage"],
    "PromotionsPage.tsx": ["PromotionModal", "PromotionsPage"],
    "StockTransferPage.tsx": ["VariantSearchInput", "CreateTransferModal"],
    "SkuMatrix.tsx": ["BarcodeCell", "SkuMatrix", "AddVariantForm"],
    "WebhooksPage.tsx": ["EndpointFormModal", "DeliveryLog", "WebhooksPage"],
    "CreditNoteFormPage.tsx": ["InvoiceSearchInput"],
    "DeliveryNoteFormPage.tsx": ["InvoiceSearchInput"],
    "InvoiceBuilderPage.tsx": ["ClientSelector", "ProductSearchCell", "VariantSearchCell"],
    "UpgradePromptModal.tsx": ["UpgradePromptModal"],
    "ColourPicker.tsx": ["ColourPicker"],
    "DashboardLayout.tsx": ["DashboardLayout"],
}

def inject_useTranslation(src_dir):
    for root, _, files in os.walk(src_dir):
        for file in files:
            if file in components_to_fix:
                filepath = os.path.join(root, file)
                comps = set(components_to_fix[file])
                
                with open(filepath, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                
                # Ensure import is present
                has_import = any("useTranslation" in line for line in lines)
                if not has_import:
                    # Insert after the first import
                    for i, line in enumerate(lines):
                        if line.startswith("import "):
                            lines.insert(i, 'import { useTranslation } from "react-i18next";\n')
                            break
                    else:
                        lines.insert(0, 'import { useTranslation } from "react-i18next";\n')

                new_lines = []
                in_component = False
                brace_depth = 0
                
                for line in lines:
                    new_lines.append(line)
                    
                    # Detect component start
                    if not in_component:
                        for comp in comps:
                            if f"function {comp}" in line or f"const {comp} = " in line:
                                in_component = True
                                current_comp = comp
                                brace_depth = 0
                                break
                    
                    if in_component:
                        # Count braces manually
                        for char in line:
                            if char == '{':
                                brace_depth += 1
                                if brace_depth == 1:
                                    # We just entered the main block of the component!
                                    # Wait, what if the first '{' is for parameters?
                                    pass
                            elif char == '}':
                                brace_depth -= 1
                                if brace_depth == 0:
                                    in_component = False
                        
                        # Wait, simple character counting won't work perfectly due to `{ props }`
                        # The function body starts at the '{' that is followed by the actual code.
                        # It is too risky to do character counting in python on TS code!
                        pass
