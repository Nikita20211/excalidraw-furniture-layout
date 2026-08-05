/**
 * Единая точка правды для адреса бэкенда EventBooking (не самой рисовалки,
 * а newdesign — там живут /drawing/* роуты DrawingController). Раньше был
 * захардкожен как "https://eventbooking.new.local" отдельно в App.tsx,
 * backendSync.ts и firebase.ts — на любом окружении, кроме локального
 * докера автора, это ломало и редирект "за токеном", и сохранение/загрузку
 * сцены, и файлы/сцену комнат Live-коллаборации.
 *
 * Значение по умолчанию — локальный докер. На реальном сервере
 * переопределяется через VITE_APP_EVENTBOOKING_BACKEND_URL в
 * .env.production.local (не коммитится, живёт только в рабочей копии,
 * из которой собирается прод-деплой).
 */
export const EVENTBOOKING_BACKEND_URL =
  import.meta.env.VITE_APP_EVENTBOOKING_BACKEND_URL ||
  "https://eventbooking.new.local";
