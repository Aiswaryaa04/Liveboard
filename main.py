from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import redis.asyncio as redis
import json
import asyncio
import uuid
import time

from database import engine, Base, SessionLocal
from models import Stroke, BoardElement

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
room_users: dict[str, dict[str, WebSocket]] = {}
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


def upsert_element(db: Session, room_id: str, element_id: str, element_type: str, data: dict, client_ts: float) -> bool:
    """
    Last-Write-Wins conflict resolution: only apply this update if it's
    newer than (or equal to, for first-create) whatever is currently stored.
    Returns True if the update was applied, False if it was rejected as stale.
    """
    existing = db.query(BoardElement).filter(BoardElement.id == element_id).first()

    if existing:
        existing_data = json.loads(existing.data)
        existing_ts = existing_data.get("_ts", 0)
        if client_ts < existing_ts:
            # A newer update already won — reject this stale one
            return False
        data["_ts"] = client_ts
        existing.data = json.dumps(data)
        db.commit()
        return True
    else:
        data["_ts"] = client_ts
        new_el = BoardElement(id=element_id, room_id=room_id, type=element_type, data=json.dumps(data))
        db.add(new_el)
        db.commit()
        return True


@app.websocket("/ws/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: str):
    await websocket.accept()
    user_id = str(uuid.uuid4())[:8]

    if room_id not in local_connections:
        local_connections[room_id] = []
        asyncio.create_task(redis_listener(room_id))
    local_connections[room_id].append(websocket)

    if room_id not in room_users:
        room_users[room_id] = {}
    room_users[room_id][user_id] = websocket

    await websocket.send_text(json.dumps({"type": "your_id", "user_id": user_id}))

    await redis_client.publish(f"room:{room_id}", json.dumps({
        "type": "presence",
        "users": list(room_users[room_id].keys())
    }))

    # Replay strokes
    db: Session = SessionLocal()
    past_strokes = db.query(Stroke).filter(Stroke.room_id == room_id).order_by(Stroke.id).all()
    for stroke in past_strokes:
        await websocket.send_text(json.dumps({
            "type": "draw",
            "x0": stroke.x0, "y0": stroke.y0,
            "x1": stroke.x1, "y1": stroke.y1,
        }))

    # Replay board elements (rects, notes)
    past_elements = db.query(BoardElement).filter(BoardElement.room_id == room_id).all()
    for el in past_elements:
        el_data = json.loads(el.data)
        await websocket.send_text(json.dumps({
            "type": f"{el.type}_restore",
            "id": el.id,
            **el_data,
        }))
    db.close()

    try:
        while True:
            data = await websocket.receive_text()
            event = json.loads(data)
            event_type = event.get("type")

            if event_type == "draw":
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

            elif event_type == "cursor":
                event["user_id"] = user_id
                await redis_client.publish(f"room:{room_id}", json.dumps(event))

            elif event_type == "rect":
                await redis_client.publish(f"room:{room_id}", data)
                db = SessionLocal()
                el_id = str(uuid.uuid4())[:8]
                upsert_element(db, room_id, el_id, "rect", {
                    "x0": event["x0"], "y0": event["y0"], "x1": event["x1"], "y1": event["y1"]
                }, time.time())
                db.close()

            elif event_type in ("note_add", "note_move", "note_edit"):
                client_ts = event.get("ts", time.time())
                db = SessionLocal()
                applied = upsert_element(db, room_id, event["id"], "note", {
                    "x": event.get("x"), "y": event.get("y"), "text": event.get("text"),
                }, client_ts)
                db.close()

                if applied:
                    # Only broadcast if this update actually won the conflict check
                    await redis_client.publish(f"room:{room_id}", data)

    except WebSocketDisconnect:
        local_connections[room_id].remove(websocket)
        del room_users[room_id][user_id]
        if not local_connections[room_id]:
            del local_connections[room_id]
        else:
            await redis_client.publish(f"room:{room_id}", json.dumps({
                "type": "presence",
                "users": list(room_users[room_id].keys())
            }))