import { useRef, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import "./App.css";

export default function Board() {
  const { roomId: ROOM_ID } = useParams();
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const isDrawing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const lastPos = useRef({ x: 0, y: 0 });

  const [connected, setConnected] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [otherCursors, setOtherCursors] = useState({});
  const [userCount, setUserCount] = useState(1);
  const [tool, setTool] = useState("pen");
  const [notes, setNotes] = useState([]);
  const draggingNote = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    const ws = new WebSocket(`ws://127.0.0.1:8002/ws/${ROOM_ID}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "draw") {
        drawLine(ctx, data.x0, data.y0, data.x1, data.y1);
      } else if (data.type === "rect") {
        drawRect(ctx, data.x0, data.y0, data.x1, data.y1);
      } else if (data.type === "note_add") {
        setNotes((prev) => [...prev, { id: data.id, x: data.x, y: data.y, text: data.text }]);
      } else if (data.type === "note_move") {
        setNotes((prev) => prev.map((n) => (n.id === data.id ? { ...n, x: data.x, y: data.y } : n)));
      } else if (data.type === "note_edit") {
        setNotes((prev) => prev.map((n) => (n.id === data.id ? { ...n, text: data.text } : n)));
      } else if (data.type === "your_id") {
        setMyUserId(data.user_id);
      } else if (data.type === "presence") {
        setUserCount(data.users.length);
      } else if (data.type === "cursor") {
        setOtherCursors((prev) => {
          if (data.user_id === myUserId) return prev;
          return { ...prev, [data.user_id]: { x: data.x, y: data.y } };
        });
      }
    };

    return () => ws.close();
  }, [ROOM_ID]);

  function drawLine(ctx, x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function drawRect(ctx, x0, y0, x1, y1) {
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e) {
    const pos = getPos(e);
    if (tool === "note") {
      const id = Math.random().toString(36).substring(2, 9);
      const note = { id, x: pos.x, y: pos.y, text: "New note" };
      setNotes((prev) => [...prev, note]);
      wsRef.current.send(JSON.stringify({ type: "note_add", ...note }));
      return;
    }
    isDrawing.current = true;
    startPos.current = pos;
    lastPos.current = pos;
  }

  function handleMouseMove(e) {
    const pos = getPos(e);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cursor", x: pos.x, y: pos.y }));
    }

    if (!isDrawing.current) return;
    const ctx = canvasRef.current.getContext("2d");

    if (tool === "pen") {
      drawLine(ctx, lastPos.current.x, lastPos.current.y, pos.x, pos.y);
      wsRef.current.send(JSON.stringify({
        type: "draw", x0: lastPos.current.x, y0: lastPos.current.y, x1: pos.x, y1: pos.y,
      }));
      lastPos.current = pos;
    }
  }

  function handleMouseUp(e) {
    if (tool === "rect" && isDrawing.current) {
      const pos = getPos(e);
      const ctx = canvasRef.current.getContext("2d");
      drawRect(ctx, startPos.current.x, startPos.current.y, pos.x, pos.y);
      wsRef.current.send(JSON.stringify({
        type: "rect", x0: startPos.current.x, y0: startPos.current.y, x1: pos.x, y1: pos.y,
      }));
    }
    isDrawing.current = false;
  }

  function handleNoteDrag(id) {
    draggingNote.current = id;
  }

  function handleBoardMouseMoveForNotes(e) {
    if (!draggingNote.current) return;
    const pos = getPos(e);
    setNotes((prev) => prev.map((n) => (n.id === draggingNote.current ? { ...n, x: pos.x, y: pos.y } : n)));
  }

  function handleBoardMouseUpForNotes(e) {
    if (draggingNote.current) {
      const pos = getPos(e);
      wsRef.current.send(JSON.stringify({ type: "note_move", id: draggingNote.current, x: pos.x, y: pos.y }));
      draggingNote.current = null;
    }
  }

  function handleNoteTextChange(id, newText) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text: newText } : n)));
    wsRef.current.send(JSON.stringify({ type: "note_edit", id, text: newText }));
  }

  function clearCanvas() {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setNotes([]);
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          LiveBoard
        </div>
        <div className="topbar-right">
          <span className={`status-pill ${connected ? "online" : "offline"}`}>
            <span className="status-dot" />
            {connected ? "Connected" : "Disconnected"}
          </span>
          <span className="room-pill">👥 {userCount} online</span>
          <span className="room-pill">Room: {ROOM_ID}</span>
          <button className="clear-btn" onClick={() => { navigator.clipboard.writeText(window.location.href); alert("Link copied!"); }}>
            Copy link
          </button>
          <button className="clear-btn" onClick={clearCanvas}>Clear board</button>
        </div>
      </header>

      <div className="toolbar">
        <button className={`tool-btn ${tool === "pen" ? "active" : ""}`} onClick={() => setTool("pen")}>✏️ Pen</button>
        <button className={`tool-btn ${tool === "rect" ? "active" : ""}`} onClick={() => setTool("rect")}>▭ Rectangle</button>
        <button className={`tool-btn ${tool === "note" ? "active" : ""}`} onClick={() => setTool("note")}>🗒️ Sticky Note</button>
      </div>

      <main
        className="board-wrap"
        onMouseMove={handleBoardMouseMoveForNotes}
        onMouseUp={handleBoardMouseUpForNotes}
      >
        <canvas
          ref={canvasRef}
          width={900}
          height={550}
          className="board-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {Object.entries(otherCursors).map(([id, pos]) => (
          <div key={id} className="cursor-dot" style={{ left: pos.x, top: pos.y }} />
        ))}
        {notes.map((note) => (
          <div
            key={note.id}
            className="sticky-note"
            style={{ left: note.x, top: note.y }}
            onMouseDown={(e) => { e.stopPropagation(); handleNoteDrag(note.id); }}
          >
            <textarea
              className="sticky-note-text"
              value={note.text}
              onChange={(e) => handleNoteTextChange(note.id, e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
        ))}
      </main>
    </div>
  );
}