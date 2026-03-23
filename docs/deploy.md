# Deploying MinusX Docs

Static Next.js export served by Nginx in Docker.

## Deploy

```bash
cd docs
docker compose up --build -d
```

## Updating

```bash
cd docs
git pull
docker compose up --build -d
```
