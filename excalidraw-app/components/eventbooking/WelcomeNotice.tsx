import { useState } from "react";
import type { ExcalidrawImperativeAPI } from "../../../packages/excalidraw/types";
import { fetchGalleryImages } from "../../data/backendSync";
import { insertGalleryImagesRow } from "../../data/planImage";
import "./WelcomeNotice.scss";

/**
 * Приветственное уведомление при входе в рисовалку — показывается каждый
 * раз при открытии доски (без запоминания в localStorage: попросили просто
 * "сразу после попадания в интерфейс", про постоянное скрытие речи не было).
 * Кнопка внутри вставляет все фото площадки разом, в ряд под планом
 * помещения (insertGalleryImagesRow) — в отличие от кнопки в бургер-меню,
 * которая по-прежнему открывает диалог с выбором фото по одному.
 */
export const WelcomeNotice = ({
  token,
  excalidrawAPI,
  isAccountLevel = false,
}: {
  token: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /**
   * Токен без привязки к чату (chatId=0, "стандартное" открытие рисовалки
   * без ссылки из чата, см. DrawingController::actionUserTokenRedirect) —
   * фото площадки грузить неоткуда (нет ChatProduct), вместо кнопки
   * показываем призыв открыть одну из уже сохранённых досок.
   */
  isAccountLevel?: boolean;
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (!isVisible) {
    return null;
  }

  if (isAccountLevel) {
    return (
      <div className="eb-welcome-notice">
        <div className="eb-welcome-notice__header">
          <div className="eb-welcome-notice__title">
            Инструмент планирования мероприятия
          </div>
          <button
            type="button"
            className="eb-welcome-notice__close"
            onClick={() => setIsVisible(false)}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        <p className="eb-welcome-notice__text">
          Вы открыли планировщик без привязки к конкретному чату. Выберите
          одну из ваших сохранённых досок в пункте меню «Открыть» (значок в
          левом верхнем углу), либо начните рисовать прямо здесь — при
          нажатии «Сохранить на сервер» это станет вашей личной доской, не
          привязанной ни к одному чату.
        </p>
      </div>
    );
  }

  const handleLoadPhotos = async () => {
    if (!excalidrawAPI) {
      return;
    }
    setIsLoading(true);
    setStatus(null);
    try {
      const response = await fetchGalleryImages(token);
      if (!response.images.length) {
        setStatus("Фотографий площадки нет");
        return;
      }
      await insertGalleryImagesRow(excalidrawAPI, response.images);
      setStatus(null);
      setIsVisible(false);
    } catch {
      setStatus("Не удалось загрузить фотографии");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="eb-welcome-notice">
      <div className="eb-welcome-notice__header">
        <div className="eb-welcome-notice__title">
          Инструмент планирования мероприятия
        </div>
        <button
          type="button"
          className="eb-welcome-notice__close"
          onClick={() => setIsVisible(false)}
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>
      <p className="eb-welcome-notice__text">
        Вы попали в инструмент планирование мероприятия, здесь вы можете
        создавать наброски, списки, карты смыслов, делиться рабочей зоной и
        совместно редактировать в реальном времени. Если для планирования вам
        нужно подгрузить фотографии площадки то нажмите на кнопку "загрузить
        фотографии", также вы можете совместно с менеджером площадки
        обсудить все нюансы помещения наглядно с визуализацией.
      </p>
      <button
        type="button"
        className="eb-welcome-notice__button"
        onClick={handleLoadPhotos}
        disabled={isLoading}
      >
        {isLoading ? "Загрузка…" : "Загрузить фотографии площадки"}
      </button>
      {status && <p className="eb-welcome-notice__status">{status}</p>}
    </div>
  );
};
