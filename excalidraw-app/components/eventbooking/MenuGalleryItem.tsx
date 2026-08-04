import { useState } from "react";
import { MainMenu } from "../../../packages/excalidraw/index";
import { ImageIcon } from "../../../packages/excalidraw/components/icons";
import { Dialog } from "../../../packages/excalidraw/components/Dialog";
import type { ExcalidrawImperativeAPI } from "../../../packages/excalidraw/types";
import { fetchGalleryImages } from "../../data/backendSync";
import { insertGalleryImage, type GalleryImageEntry } from "../../data/planImage";

/**
 * "Загрузить фотографии площадки" — фото товара (не план помещения),
 * вставляются на канвас как обычные (не залоченные) картинки.
 */
export const MenuGalleryItem = ({
  token,
  excalidrawAPI,
}: {
  token: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [images, setImages] = useState<GalleryImageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (event: Event) => {
    // Без preventDefault() клик по MainMenu.Item закрывает и размонтирует
    // весь DropdownMenu.Content вместе с этим компонентом и его isOpen.
    event.preventDefault();
    setIsOpen(true);
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchGalleryImages(token);
      setImages(response.images);
    } catch {
      setError("Не удалось загрузить фотографии");
    } finally {
      setIsLoading(false);
    }
  };

  const insertImage = async (image: GalleryImageEntry) => {
    if (!excalidrawAPI) {
      return;
    }
    // Ставит фото в ряд под планом помещения, правее уже вставленных —
    // повторные клики больше не наслаиваются друг на друга.
    await insertGalleryImage(excalidrawAPI, image);
    setIsOpen(false);
  };

  return (
    <>
      <MainMenu.Item icon={ImageIcon} onSelect={handleClick}>
        Загрузить фотографии площадки
      </MainMenu.Item>
      {isOpen && (
        <Dialog
          size="regular"
          onCloseRequest={() => setIsOpen(false)}
          title="Фотографии площадки"
        >
          <div
            style={{
              padding: "0 1rem 1rem",
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "0.5rem",
            }}
          >
            {isLoading && <p>Загрузка…</p>}
            {error && <p>{error}</p>}
            {!isLoading && images.length === 0 && !error && (
              <p>Фотографий нет</p>
            )}
            {images.map((image) => (
              <img
                key={image.id}
                src={image.dataUrl}
                alt=""
                style={{ width: "100%", cursor: "pointer", borderRadius: 4 }}
                onClick={() => insertImage(image)}
              />
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
};
