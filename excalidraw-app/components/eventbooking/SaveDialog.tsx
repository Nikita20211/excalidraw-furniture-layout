import { useState } from "react";
import { Dialog } from "../../../packages/excalidraw/components/Dialog";

export const SaveDialog = ({
  isSaving,
  onCancel,
  onConfirm,
}: {
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) => {
  const [title, setTitle] = useState("");

  return (
    <Dialog size="small" onCloseRequest={onCancel} title="Сохранить доску">
      <div style={{ padding: "0 1rem 1rem" }}>
        <input
          type="text"
          placeholder="Название (необязательно)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          style={{ width: "100%", marginBottom: "1rem", boxSizing: "border-box" }}
          autoFocus
        />
        <div
          style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}
        >
          <button type="button" onClick={onCancel} disabled={isSaving}>
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onConfirm(title)}
            disabled={isSaving}
          >
            {isSaving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
