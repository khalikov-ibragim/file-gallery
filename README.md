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
    ├── _helpers.tpl
    ├── deployment.yaml
    ├── service.yaml
    ├── pvc.yaml
    ├── hpa.yaml
    ├── secret.yaml
    ├── frontend-nginx-config.yaml
    ├── ingress.yaml
    └── NOTES.txt
```

Установка (из корня репозитория):

```bash
helm upgrade --install file-gallery ./chart \
  --namespace file-gallery \
  --create-namespace \
  -f ./chart/values.yaml \
  -f ./chart/values-secrets.yaml
```

Что создаётся:

| Ресурс | Имя | Комментарий |
|---|---|---|
| Deployment | `<release>-backend` | 2 реплики, HPA 2–5 по CPU 80% |
| Deployment | `<release>-frontend` | nginx + ConfigMap с корректным `nginx.conf` |
| Deployment | `<release>-bd` | PostgreSQL 16, PVC 1Gi |
| Deployment | `<release>-minio` | MinIO, PVC 2Gi, консоль `:9001` |
| Deployment | `<release>-pgadmin` | pgAdmin, PVC 1Gi |
| Service | `<release>-<component>` | frontend/pgadmin — NodePort, остальные ClusterIP |
| Secret | `<release>-secrets` | общий для backend/bd/minio/pgadmin (`envFrom`) |
| PVC | `<release>-bd`, `<release>-minio`, `<release>-pgadmin` | StorageClass `local-path` (k3s) |
| HPA | `<release>-backend` | требует metrics-server |

Namespace чарт не создаёт — его создаёт `--create-namespace`.

Проверка и доступ:

```bash
kubectl get pods,pvc,hpa -n file-gallery
kubectl get svc -n file-gallery

# фронтенд (NodePort) — порт выдаётся динамически
kubectl get svc file-gallery-frontend -n file-gallery

# либо port-forward
kubectl port-forward svc/file-gallery-frontend 8080:80 -n file-gallery
# консоль MinIO
kubectl port-forward svc/file-gallery-minio 9001:9001 -n file-gallery
# MinIO API (нужен, если MINIO_PUBLIC_URL=http://localhost:9000)
kubectl port-forward svc/file-gallery-minio 9000:9000 -n file-gallery
```

Адреса после port-forward:

- **Галерея:** http://localhost:8080
- **Консоль MinIO:** http://localhost:9001
- **pgAdmin:** http://localhost:6789

Backend и PostgreSQL наружу не публикуются: backend доступен только через
`frontend` (nginx проксирует `/api/`), PostgreSQL — только внутри кластера.

Обновление / откат / удаление:

```bash
helm upgrade file-gallery ./chart -n file-gallery -f ./chart/values.yaml -f ./chart/values-secrets.yaml
helm history file-gallery -n file-gallery
helm rollback file-gallery <revision> -n file-gallery
helm uninstall file-gallery -n file-gallery
```

## API backend

| Метод | Путь                | Описание                         |
|-------|---------------------|----------------------------------|
| GET   | `/api/files`        | список файлов                    |
| POST  | `/api/upload`       | multipart-загрузка, поле `file`  |
| DELETE| `/api/files/:id`    | удаление файла                   |

## Главная ловушка: MINIO_PUBLIC_URL

Backend загружает файл в MinIO через **внутреннюю** сеть (по имени `minio:9000`
в compose или `<release>-minio:9000` в Kubernetes).
Но браузер потом грузит картинку через `<img src>` **напрямую из MinIO** — то есть
не из внутренней сети, а с машины пользователя. Поэтому:

- внутреннее подключение → `MINIO_HOST` / `MINIO_PORT` (в Helm чарт подставляет их сам)
- публичный URL для браузера → **отдельная** `MINIO_PUBLIC_URL` (например `http://localhost:9000`)

Если перепутать — upload пройдёт, но картинки в браузере будут «битыми» или вечно
грузиться. В Kubernetes при `MINIO_PUBLIC_URL=http://localhost:9000` нужен
`kubectl port-forward svc/file-gallery-minio 9000:9000`.

Аналогично `DB_HOST` в Kubernetes — это имя Service (`<release>-bd`), а не `bd`
из compose. Чарт вычисляет его из имени релиза автоматически.

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
