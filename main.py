from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as redis
import json
import asyncio

app = FastAPI(title="LiveBoard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Local connections this specific server instance is handling
local_connections: dict[str, list[WebSocket]] = {}

redis_client = redis.Redis(host="localhost", port=6379, db=2, decode_responses=True)


async def redis_listener(room_id: str):
    """
    Subscribes to this room's Redis channel and forwards any message
    to every client connected to THIS server instance for that room.
    """
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
        # First client in this room on this server instance — start listening to Redis for it
        asyncio.create_task(redis_listener(room_id))

    local_connections[room_id].append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            # Instead of broadcasting directly, publish to Redis —
            # every server instance subscribed to this room (including this one) will receive it
            await redis_client.publish(f"room:{room_id}", data)

    except WebSocketDisconnect:
        local_connections[room_id].remove(websocket)
        if not local_connections[room_id]:
            del local_connections[room_id]