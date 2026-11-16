import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";
import AddCourierForm from "../components/AddCourierForm";
import CourierAccountCard from "../components/CourierAccountCard";
import { credentialLabel } from "../credentialLabels";
import type { CourierAccount, CourierCatalogueEntry } from "../types";

const t = i18n.t.bind(i18n);

const MAYSTRO: CourierCatalogueEntry = {
  key: "maystro", name: "Maystro", platform: "maystro", required_credentials: ["apiKey"],
  capabilities: {}, endpoint: "https://backend.example.dz/api", requires_base_url: false, base_url_suffixes: [],
};
const YALIDINE: CourierCatalogueEntry = {
  key: "yalidine", name: "Yalidine", platform: "yalidine", required_credentials: ["apiId", "apiToken"],
  capabilities: {}, endpoint: "https://api.example.dz", requires_base_url: false, base_url_suffixes: [],
};
const ECOTRACK: CourierCatalogueEntry = {
  key: "ecotrack", name: "Ecotrack (any tenant)", platform: "ecotrack", required_credentials: ["token"],
  capabilities: {}, endpoint: null, requires_base_url: true, base_url_suffixes: [".ecotrack.dz"],
};

function renderForm(overrides: Partial<Parameters<typeof AddCourierForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onRetryCatalogue = vi.fn();
  render(
    <AddCourierForm
      couriers={[MAYSTRO, YALIDINE, ECOTRACK]}
      configuredKeys={[]}
      catalogueLoading={false}
      catalogueRefreshing={false}
      onRetryCatalogue={onRetryCatalogue}
      saving={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, onRetryCatalogue };
}

describe("credentialLabel", () => {
  it("translates known names and falls back to the raw name", () => {
    expect(credentialLabel(t, "apiKey")).toBe(t("deliveries.cred_apiKey"));
    expect(credentialLabel(t, "brandNewField")).toBe("brandNewField");
  });
});

describe("AddCourierForm", () => {
  it("asks for exactly the selected courier's credentials and submits them", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.selectOptions(screen.getByRole("combobox"), "yalidine");
    const add = screen.getByRole("button", { name: t("common.add") });
    expect(add).toBeDisabled();

    await user.type(screen.getByLabelText(t("deliveries.cred_apiId")), " id-1 ");
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText(t("deliveries.cred_apiToken")), "tok-2");
    expect(add).toBeEnabled();
    expect(screen.queryByLabelText(t("deliveries.cred_apiKey"))).not.toBeInTheDocument();

    await user.click(add);
    expect(onSubmit).toHaveBeenCalledWith({
      courier: "yalidine",
      credentials: { apiId: "id-1", apiToken: "tok-2" },
    });
  });

  it("requires a base address for the generic Ecotrack courier", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.selectOptions(screen.getByRole("combobox"), "ecotrack");
    await user.type(screen.getByLabelText(t("deliveries.cred_token")), "t");
    const add = screen.getByRole("button", { name: t("common.add") });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText(t("deliveries.base_url")), "https://shop.ecotrack.dz");
    await user.click(add);
    expect(onSubmit).toHaveBeenCalledWith({
      courier: "ecotrack",
      credentials: { token: "t" },
      base_url: "https://shop.ecotrack.dz",
    });
  });

  it("hides couriers that are already configured", () => {
    renderForm({ configuredKeys: ["maystro"] });
    const values = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "ecotrack", "yalidine"]);
  });

  it("offers a retry when the catalogue could not be loaded", async () => {
    const user = userEvent.setup();
    const { onRetryCatalogue } = renderForm({ couriers: [] });
    expect(screen.getByText(t("deliveries.catalogue_unavailable"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("common.refresh") }));
    expect(onRetryCatalogue).toHaveBeenCalledTimes(1);
  });
});

describe("CourierAccountCard", () => {
  const account: CourierAccount = {
    id: "1", courier: "yalidine", courier_name: "Yalidine", platform: "yalidine",
    required_credentials: ["apiId", "apiToken"], saved_credentials: ["apiToken"], missing_credentials: ["apiId"],
    base_url: "", is_active: true, created_at: "", updated_at: "",
  };

  it("shows saved and missing credentials without any value, and saves a replacement", async () => {
    const user = userEvent.setup();
    const onSaveCredential = vi.fn();
    render(
      <CourierAccountCard
        account={account}
        saving={false}
        onSaveCredential={onSaveCredential}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText(t("deliveries.credential_saved"))).toBeInTheDocument();
    expect(screen.getByText(t("deliveries.credential_missing"))).toBeInTheDocument();
    expect(
      screen.getByText(t("deliveries.credentials_missing", { names: t("deliveries.cred_apiId") })),
    ).toBeInTheDocument();
    expect(document.querySelectorAll("input")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: t("deliveries.credential_replace") }));
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("password");
    await user.type(input, "new-token");
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    expect(onSaveCredential).toHaveBeenCalledWith("apiToken", "new-token");
  });
});
