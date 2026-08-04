import React from "react";
import BulkImportWizardModal, { ImportEntityType } from "@/components/import/BulkImportWizardModal";

interface Props {
  title?: string;
  endpoint?: string;
  templateCsv?: string;
  templateFilename?: string;
  entity?: ImportEntityType;
  onSuccess: () => void;
  onClose: () => void;
}

export default function ImportModal({
  endpoint,
  entity,
  onSuccess,
  onClose,
}: Props) {
  let detectedEntity: ImportEntityType = entity || "products";
  if (!entity && endpoint) {
    if (endpoint.includes("client")) detectedEntity = "clients";
    else if (endpoint.includes("supplier")) detectedEntity = "suppliers";
    else detectedEntity = "products";
  }

  return (
    <BulkImportWizardModal
      initialEntity={detectedEntity}
      onSuccess={onSuccess}
      onClose={onClose}
    />
  );
}
