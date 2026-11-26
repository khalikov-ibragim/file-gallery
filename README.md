# File Gallery

Небольшая галерея изображений: загрузка файлов через backend, хранение метаданных в PostgreSQL, файлов — в MinIO, фронтенд отдаётся через Nginx.

Проект поддерживает два режима запуска:

- **Docker/Podman Compose** — для локальной разработки и быстрой проверки.
- **Kubernetes (k3s) + Helm** — деплой через чарт в `chart/`.

## Стек

- **Frontend:** HTML/CSS/JS, Nginx
- **Backend:** Node.js, Express
- **PostgreSQL:** метаданные файлов
- **MinIO:** S3-совместимое хранилище файлов
- **pgAdmin:** веб-консоль PostgreSQL (опционально)
- **Инфраструктура:** Docker Compose, Kubernetes (k3s), Helm
- **CI/CD:** GitHub Actions

## Структура репозитория

```text
.
├── backend/                  # Node.js/Express API, Dockerfile
├── frontend/                 # Статика + nginx.conf, Dockerfile
├── chart/                    # Helm-чарт для k3s
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── values-secrets.example.yaml
│   └── templates/
├── .github/workflows/ci.yml  # lint + compose-тесты + push + helm deploy
├── docker-compose.yml        # Локальный/dev запуск
├── .env.example              # Пример env для Docker Compose
├── PROJECT-gallery.md        # Исходное ТЗ/описание учебного проекта
└── README.md
```

## Сервисы и порты

### Docker Compose (`docker-compose.yml`)

| Сервис | Порт хоста | Назначение | Зависимости |
|--------|------------|------------|-------------|
| `frontend` | `8080:80` | Веб-интерфейс | `backend` |
| `backend` | `4000:4000` | REST API | `bd`, `minio` |
| `bd` | внутренний `5432` | PostgreSQL | — |
| `minio` | `9000:9000`, `9001:9001` | S3 API / Web Console | — |
| `pgadmin` | `8081:80` | pgAdmin | — |

### Helm/k3s (`chart/values.yaml`)

| Сервис | Service type | Service port | NodePort / Target |
|--------|--------------|--------------|-------------------|
| `backend` | NodePort | `4000` | nodePort `30050`, target `4000` |
| `frontend` | NodePort | `80` | nodePort `30080`, target `80` |
| `bd` | ClusterIP | `5432` | target `5432` |
| `minio` | ClusterIP + NodePort console | `9000`, `9090` | console nodePort `30091` |
| `pgadmin` | NodePort | `80` | nodePort `30092`, target `80` |

> Точные значения смотри в `chart/values.yaml` — там же заданы probes, resources, strategy, HPA.

## Быстрый старт (Docker Compose)

```bash
# 1. Клонировать
git clone <repo-url>
cd file-gallery

# 2. Подготовить env
cp .env.example .env
# Отредактируй .env при необходимости

# 3. Запустить
docker compose up -d --build

# 4. Проверить
docker compose ps
curl http://localhost:4000/health
```

После запуска:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:4000`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`
- pgAdmin: `http://localhost:8081`

## Переменные окружения

### Docker Compose

Источник: `.env.example`.

| Переменная | Назначение |
|------------|------------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Подключение backend к PostgreSQL |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Инициализация PostgreSQL |
| `MINIO_HOST`, `MINIO_PORT` | Адрес MinIO для backend внутри docker-сети |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Учётные данные MinIO/S3 |
| `MINIO_BUCKET` | Бакет для файлов |
| `MINIO_PUBLIC_URL` | Публичный URL MinIO, который браузер использует в `<img src>` |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Root-пользователь MinIO |
| `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD` | Доступ к pgAdmin |

Важно: `MINIO_PUBLIC_URL` должен быть доступен из браузера пользователя. Для локального Compose обычно `http://localhost:9000`.

### Helm

Шаблон секретов: `chart/values-secrets.example.yaml` → локальный `chart/values-secrets.yaml`.

Реальные секреты не коммитятся. В CI секрет передаётся через GitHub Secret `FILE_GALLERY_SECRETS` и создаётся во временном файле перед `helm upgrade`.

## Запуск в Kubernetes (Helm)

```bash
cp chart/values-secrets.example.yaml chart/values-secrets.yaml
# Заполни реальные значения

helm upgrade --install file-gallery ./chart \
  --namespace file-gallery --create-namespace \
  -f ./chart/values.yaml \
  -f ./chart/values-secrets.yaml
```

Проверки:

```bash
helm lint ./chart -f ./chart/values.yaml
helm template file-gallery ./chart \
  -f ./chart/values.yaml \
  -f ./chart/values-secrets.yaml | kubeconform -strict -summary -
kubectl get pods,svc,pvc -n file-gallery
```

## CI/CD

Workflow: `.github/workflows/ci.yml`.

| Job | Что делает |
|-----|------------|
| `lint` | yamllint compose, hadolint Dockerfile, shellcheck, helm lint + kubeconform |
| `basic` | compose smoke test, Python API test, push образов в Docker Hub с `latest` и `${GITHUB_SHA::7}` |
| `deploy` | deploy в k3s через `helm upgrade --install` с `--rollback-on-failure` |

Используемые GitHub Secrets: `DOCKER_USERNAME`, `DOCKER_PASSWORD`, `KUBE_CONFIG_DATA`, `FILE_GALLERY_SECRETS`.

## Полезные команды

```bash
# Compose
docker compose ps
docker compose logs -f backend
docker compose down

# Helm / k3s
kubectl get pods,svc,pvc -n file-gallery
kubectl logs -n file-gallery deploy/backend --tail=100
kubectl describe pod -n file-gallery <pod-name>
```

## Примечания

- `PROJECT-gallery.md` содержит исходное учебное ТЗ/легенду проекта.
- Для MinIO в браузере важен корректный `MINIO_PUBLIC_URL`; внутренний адрес `minio:9000` из docker/k8s-сети с браузера недоступен.
- Перед push проверяй, что реальные `values-secrets.yaml` и `.env` не попадают в git.
