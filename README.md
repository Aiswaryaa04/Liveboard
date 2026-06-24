# LiveBoard

LiveBoard is a real-time collaborative whiteboard — the same category of problem as Figma or Miro, just built at a smaller scale to really understand how multiplayer, low-latency collaboration actually works under the hood. Multiple people can join the same room, draw, drop sticky notes, and see each other's cursors moving in real time, with everything persisted so a refresh doesn't lose the board.

## The core idea

Most apps are built around a single user acting on their own data. A collaborative whiteboard is different: many people are looking at and changing the *same* shared state simultaneously, and everyone needs to see everyone else's changes almost instantly. That requirement touches several distinct problems at once — real-time messaging, coordinating state across multiple users, and making sure the board survives reconnects and refreshes without losing anything.

## How it actually works

**Real-time drawing:** Each mouse movement while drawing sends a tiny line segment (`x0,y0 → x1,y1`) over a WebSocket connection. The backend doesn't just forward it directly to other clients connected to the same server process — it publishes the event to a Redis pub/sub channel scoped to that room. Every server instance subscribed to that room's channel (including the one that received the original message) picks it up and forwards it to its own connected clients. This is the part that actually makes the system horizontally scalable: if you ran multiple backend instances behind a load balancer, a client on server A would still see drawing events from a client on server B, because Redis is the shared coordination layer between them — not server memory.

**Rooms and shareable links:** Visiting the homepage and clicking "Create Room" generates a random room ID and navigates to `/room/<id>`. That URL is the entire "invite" — anyone who opens it joins the same WebSocket room and sees the same board. There's no separate invite system; the URL itself is the access mechanism.

**Presence and cursor sync:** Every connection gets a short random user ID on connect. The server tracks which user IDs are currently in each room and broadcasts an updated count whenever someone joins or leaves — that's the "N online" indicator. Separately, every mouse movement (not just while drawing) sends a lightweight cursor position event, so everyone in the room can see small dots representing where other people's mice currently are, even when they're not actively drawing.

**Persistence and recovery:** Every stroke, rectangle, and sticky note is written to PostgreSQL as it happens. When a new client connects — whether it's a brand-new visitor or someone refreshing the page — the server queries everything saved for that room and replays it back to them before any new live events arrive, recreating the board exactly as it was. This is what makes a refresh non-destructive: the visible board is always reconstructible from the database, not just held in memory.

**Conflict handling:** When two people might edit the same thing at close to the same moment — say, both dragging the same sticky note — the system uses a Last-Write-Wins approach: every update carries a timestamp, and the server only applies an update if its timestamp is newer than whatever's currently stored for that element. A stale, older update arriving slightly out of order gets silently rejected rather than corrupting the element's state. It's a deliberately simple version of the kind of conflict resolution that full CRDT (Conflict-free Replicated Data Type) implementations generalize and formalize — this version handles the common case of "the most recent edit wins" without the more elaborate machinery of merging concurrent operations field-by-field.

## Project layout

```
liveboard/
├── main.py              FastAPI app: WebSocket room handling, Redis pub/sub, persistence
├── models.py            SQLAlchemy models: Stroke, BoardElement
├── database.py          DB engine/session setup
└── frontend/
    └── src/
        ├── Home.jsx     Landing page, room creation
        ├── Board.jsx    Canvas drawing, toolbar, presence, cursor sync
        ├── App.css       Styling
        └── main.jsx      Router setup
```

## Running it locally

**Backend:**
```bash
python3 -m venv venv
source venv/bin/activate
pip install fastapi "uvicorn[standard]" redis sqlalchemy psycopg2-binary python-multipart

createdb liveboard
psql liveboard -c "GRANT ALL ON SCHEMA public TO your_db_user;"

brew install redis && brew services start redis

uvicorn main:app --reload --port 8002
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`, create a room, and open the same room URL in a second browser tab or window to see the multiplayer behavior in action — drawing, cursors, and presence all sync between them live.

## Tools and what each one is doing

- **FastAPI WebSockets** handle the actual persistent, bidirectional connection between each client and the server — this is what makes "live" possible instead of the client having to repeatedly ask "anything new?"
- **Redis pub/sub** is the messaging backbone between server instances and rooms — it decouples "a client sent something" from "who needs to receive it," which is what allows the same broadcast logic to keep working even if you scale to multiple backend processes.
- **PostgreSQL** is the durable record of the board's actual content — strokes and elements survive independently of any single WebSocket connection or server restart.
- **React + Canvas API** render the actual drawing surface — Canvas was chosen over SVG because freehand drawing involves many rapidly-changing small segments, and Canvas handles that kind of frequent pixel-level update more efficiently than maintaining a DOM node per stroke.

