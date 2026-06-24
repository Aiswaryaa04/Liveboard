from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import redis.asyncio as redis
import json
import asyncio

from database import engine, Base, SessionLocal
from models import Stroke

Base.metadata.create_all(bind=engine)

app = FastAPI(title="LiveBoard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

local_connections: dict[str, list[WebSocket]] = {}
redis_client = redis.Redis(host="localhost", port=6379, db=2, decode_responses=True)


async def redis_listener(room_id: str):
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(f"room:{room_id}")
    async for message in pubsub.listen():
        if message["type"] == "message":
            data = message["data"]
            clients = local_connections.get(room_id, [])
            for client in clients:
                await client.send_text(data)


@app.websocket("/ws/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: str):
    await websocket.accept()

    if room_id not in local_connections:
        local_connections[room_id] = []
        asyncio.create_task(redis_listener(room_id))
    local_connections[room_id].append(websocket)

    # Replay saved history for this room so a reconnecting client sees the existing board
    db: Session = SessionLocal()
    past_strokes = db.query(Stroke).filter(Stroke.room_id == room_id).order_by(Stroke.id).all()
    for stroke in past_strokes:
        await websocket.send_text(json.dumps({
            "type": "draw",
            "x0": stroke.x0, "y0": stroke.y0,
            "x1": stroke.x1, "y1": stroke.y1,
        }))
    db.close()

    try:
        while True:
            data = await websocket.receive_text()
            event = json.loads(data)

            if event.get("type") == "draw":
                # Persist every stroke to Postgres before broadcasting it
                db = SessionLocal()
                new_stroke = Stroke(
                    room_id=room_id,
                    x0=event["x0"], y0=event["y0"],
                    x1=event["x1"], y1=event["y1"],
                )
                db.add(new_stroke)
                db.commit()
                db.close()

            await redis_client.publish(f"room:{room_id}", data)

    except WebSocketDisconnect:
        local_connections[room_id].remove(websocket)
        if not local_connections[room_id]:
            del local_connections[room_id]