import { useEffect, useState } from "react";
import { Dialog } from "../../../packages/excalidraw/components/Dialog";
import {
  listBoards,
  fetchScene,
  loadSnapshotById,
  rehydrateGalleryFiles,
  type BoardEntry,
  type SnapshotEntry,
  type EventBookingParams,
} from "../../data/backendSync";

const formatDate = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const boardLabel = (entry: {
  product_title: string | null;
  company_title: string | null;
}) =>
  [entry.product_title, entry.company_title].filter(Boolean).join(" — ") ||
  "Без названия";

/**
 * Список досок пользователя для меню "Открыть": автосохранения (по одному
 * на чат) и ручные сохранения — по всем чатам пользователя, не только
 * текущему (actionListBoards). Выбор элемента переключает вкладку целиком:
 * onReissueToken меняет chatId/token, затем сцена этого элемента подгружается
 * и применяется к канвасу через onApplyScene.
 */
export const BoardPickerDialog = ({
  token,
  onClose,
  onReissueToken,
  onApplyScene,
}: {
  token: string;
  onClose: () => void;
  onReissueToken: (chatId: number) => Promise<EventBookingParams | null>;
  onApplyScene: (
    scene: { elements?: unknown; appState?: unknown; files?: unknown } | null,
    planImageUrl: string | null,
  ) => Promise<void>;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autosaves, setAutosaves] = useState<BoardEntry[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    listBoards(token)
      .then((response) => {
        setAutosaves(response.autosaves);
        setSnapshots(response.snapshots);
      })
      .catch(() => setError("Не удалось загрузить список досок"))
      .finally(() => setIsLoading(false));
  }, [token]);

  const openAutosave = async (entry: BoardEntry) => {
    setPendingKey(`auto-${entry.chat_id}`);
    try {
      const nextParams = await onReissueToken(entry.chat_id);
      if (!nextParams) {
        return;
      }
      const scene = await fetchScene(nextParams.token);
      const parsed = scene.scene ? JSON.parse(scene.scene) : null;
      if (parsed) {
        parsed.files = await rehydrateGalleryFiles(
          nextParams.token,
          parsed.elements || [],
          parsed.files || {},
        );
      }
      await onApplyScene(parsed, scene.plan_image_url);
      onClose();
    } catch (err) {
      console.error("Failed to open autosaved board", err);
      setError("Не удалось открыть доску");
    } finally {
      setPendingKey(null);
    }
  };

  const openSnapshot = async (entry: SnapshotEntry) => {
    setPendingKey(`snap-${entry.id}`);
    try {
      const nextParams = await onReissueToken(entry.chat_id);
      if (!nextParams) {
        return;
      }
      const loaded = await loadSnapshotById(nextParams.token, entry.id);
      const parsed = loaded.scene ? JSON.parse(loaded.scene) : null;
      if (parsed) {
        parsed.files = await rehydrateGalleryFiles(
          nextParams.token,
          parsed.elements || [],
          parsed.files || {},
        );
      }
      await onApplyScene(parsed, loaded.plan_image_url);
      onClose();
    } catch (err) {
      console.error("Failed to open snapshot", err);
      setError("Не удалось открыть сохранение");
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <Dialog size="regular" onCloseRequest={onClose} title="Открыть доску">
      <div
        style={{ padding: "0 1rem 1rem", maxHeight: "60vh", overflowY: "auto" }}
      >
        {isLoading && <p>Загрузка…</p>}
        {error && <p>{error}</p>}
        {!isLoading && (
          <>
            <h4>Автосохранения</h4>
            {autosaves.length === 0 && <p>Нет автосохранённых досок</p>}
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {autosaves.map((entry) => (
                <li key={`auto-${entry.chat_id}`}>
                  <button
                    type="button"
                    onClick={() => openAutosave(entry)}
                    disabled={pendingKey !== null}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "0.5rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {boardLabel(entry)}
                    {entry.is_current_chat ? " (текущий чат)" : ""}
                    <br />
                    <small>{formatDate(entry.updated_at)}</small>
                    {pendingKey === `auto-${entry.chat_id}` ? " …" : ""}
                  </button>
                </li>
              ))}
            </ul>

            <h4>Ручные сохранения</h4>
            {snapshots.length === 0 && <p>Нет ручных сохранений</p>}
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {snapshots.map((entry) => (
                <li key={`snap-${entry.id}`}>
                  <button
                    type="button"
                    onClick={() => openSnapshot(entry)}
                    disabled={pendingKey !== null}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "0.5rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {entry.title} — {boardLabel(entry)}
                    {entry.is_current_chat ? " (текущий чат)" : ""}
                    <br />
                    <small>{formatDate(entry.created_at)}</small>
                    {pendingKey === `snap-${entry.id}` ? " …" : ""}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
};
