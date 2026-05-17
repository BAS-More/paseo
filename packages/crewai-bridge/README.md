# CrewAI Bridge

FastAPI bridge that wraps a CrewAI Studio install and exposes it as a REST + SSE API for Paseo.

## Startup

```bash
# Direct
python api.py

# Or with uvicorn
uvicorn api:app --port 8000
```

## Environment Variables

| Variable             | Default               | Description                                                                                                                                                    |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREWAI_STUDIO_PATH` | parent of `packages/` | Absolute path to the CrewAI Studio install directory. The bridge imports `db_utils` from `$CREWAI_STUDIO_PATH/app/` and reads `$CREWAI_STUDIO_PATH/crewai.db`. |

## Endpoints

| Method | Path          | Description                                                             |
| ------ | ------------- | ----------------------------------------------------------------------- |
| `GET`  | `/health`     | Returns `{"status":"ok","crewai_version":"..."}`                        |
| `GET`  | `/crew/list`  | Lists all crews from the CrewAI Studio DB                               |
| `GET`  | `/agent/list` | Lists all agents from the CrewAI Studio DB                              |
| `POST` | `/crew/run`   | Runs a crew; streams SSE events (`status`, `result`, `error`, `[DONE]`) |
| `GET`  | `/crew/runs`  | Lists completed runs; optional `?since=<ISO8601>` filter                |

### POST /crew/run — request body

```json
{ "crew_id": "<id from /crew/list>", "inputs": {} }
```

### SSE event shape

```
data: {"type": "status",  "message": "Starting crew run..."}
data: {"type": "result",  "output": "..."}
data: {"type": "error",   "message": "..."}
data: [DONE]
```

## Running tests

```bash
pip install -r requirements.txt
pytest test_api.py -v
```
