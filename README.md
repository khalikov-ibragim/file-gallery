# File Gallery

Галерея изображений с загрузкой файлов в S3-совместимое хранилище. Пользователь загружает изображение через форму, оно отображается в общей сетке с возможностью удаления.

Проект поддерживает запуск через **Docker/Podman Compose** для локальной разработки, а также развёртывание в **Kubernetes (k3s)** с использованием собственного **Helm-чарта** из директории `chart/`.

## Стек

- **Backend:** Node.js, Express (REST API)
- **PostgreSQL:** метаданные файлов (имя, размер, дата)
- **MinIO:** S3-совместимое хранилище файлов
- **Frontend:** HTML/CSS/JS, Nginx
- **Оркестрация:** Kubernetes (k3s), Helm, Docker Compose, Podman Compose
- **CI/CD:** GitHub Actions

## Состав сервисов

| Сервис    | Порт снаружи                | Зависит от           | Том      |
|-----------|-----------------------------|----------------------|----------|
| frontend  | `8080`                      | backend              | —        |
| backend   | `4000`                      | Postgres + MinIO     | —        |
| Postgres  | —                           | —                    | `postgres` |
| MinIO     | `9000` (API), `9001` (консоль) | —                    | `minio`   |
| pgAdmin   | `6789`                      | Postgres             | `pgadmin`|

## Развёртывание

### Docker/Podman Compose (локально)

```bash
cp .env.example .env     # заполни значения
podman-compose up -d     # или docker compose up -d
```

### Kubernetes (Helm)

В репозитории есть готовый Helm-чарт для развёртывания в кластере:

```text
chart/
├── Chart.yaml
├── values.yaml
├── values-secrets.yaml
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    ├── ingress.yaml
    ├── hpa.yaml
    ├── secret.yaml
    ├── namespace.yaml
    └── _helpers.tpl
```

Установка:

```bash
helm upgrade --install file-gallery ./chart -n file-gallery --create-namespace -f chart/values.yaml -f chart/values-secrets.yaml
```

Чарт использует шаблоны с параметризацией через `values.yaml`, содержит `HorizontalPodAutoscaler`, `Ingress`, `ConfigMap/Secret`, а также хелперы в `_helpers.tpl`.

Затем:

- **Галерея:** http://localhost:8080
- **Backend API:** http://localhost:4000 (`GET /health`)
- **Консоль MinIO:** http://localhost:9001 (файлы внутри)
- **pgAdmin:** http://localhost:6789

## API backend

| Метод | Путь                | Описание                         |
|-------|---------------------|----------------------------------|
| GET   | `/api/files`        | список файлов                    |
| POST  | `/api/upload`       | multipart-загрузка, поле `file`  |
| DELETE| `/api/files/:id`    | удаление файла                   |

## Главная ловушка: MINIO_PUBLIC_URL

Backend загружает файл в MinIO через **внутреннюю** docker-сеть (по имени `minio:9000`).
Но браузер потом грузит картинку через `<img src>` **напрямую из MinIO** — то есть
не из docker-сети, а с хост-машины. Поэтому:

- внутреннее подключение → `MINIO_HOST` / `MINIO_PORT` (например `minio:9000`)
- публичный URL для браузера → **отдельная** `MINIO_PUBLIC_URL` (например `http://localhost:9000`)

Если перепутать — upload пройдёт, но картинки в браузере будут «битыми» или вечно
грузиться.

## Известные ловушки / TODO

1. **Healthcheck MinIO использует `curl`**, которого в образе `minio/minio` часто
   нет (образ на базе UBI-micro). Если healthcheck «вечно красный» и backend не
   стартует — используй `mc ready local` либо добавь `curl`.
2. **Публичный бакет**: политика бакета разрешает чтение всем (`s3:GetObject`).
   Для прода лучше presigned URL (см. ТЗ «со звёздочкой»).
3. **Нет авторизации** на upload/delete — осознанно, учебный MVP.
4. Порты MinIO `9000` и `9001` торчат наружу — безопаснее наружу выставить только
   консоль.
5. Названия контейнеров/сервисов не очень читаемые (`bd`, `back`, `front`) —
   условность, можно переименовать.

Подробное техническое задание — в [`PROJECT-gallery.md`](./PROJECT-gallery.md).
