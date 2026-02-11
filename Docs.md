# MinusX Documentation

## Setup (Development)

### 1. Install Dependencies

**Backend:**
```bash
cd backend
uv sync
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2. Configure Environment Variables

The frontend and backend requires env configuration. **This is a one-time setup.**

```bash
cd frontend
cp .env.example .env

cd backend
cp .env.example .env
```

Edit `backend/.env` and add your key:
```bash
ANTHROPIC_API_KEY=<your-anthropic-key>
```

Generate the required secret:
```bash
# NEXTAUTH_SECRET (required by NextAuth v5)
openssl rand -base64 32
```

Edit `frontend/.env` and add the generated secret:
```bash
NEXTAUTH_SECRET=<generated-secret-here>
```

The backend requires no configuration for local development - all defaults work out of the box!

### 3. Download Sample DuckDB Database

The application uses DuckDB for analytics. Download the sample database:

```bash
# From project root
mkdir -p data
cd data
curl -L -o default_db.duckdb https://raw.githubusercontent.com/minusxai/sample_datasets/refs/heads/master/adventureworks/adventureworks.duckdb

```

This downloads the AdventureWorks sample database (~5MB) used in the default connection.

### 4. Start the Services

Now you're ready to start both services:

**Terminal 1 - Backend:**
```bash
cd backend
uv run uvicorn main:app --reload --reload-include='*.yaml' --port 8001
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

The application will be available at http://localhost:3000
