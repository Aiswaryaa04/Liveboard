import { useRef, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import "./App.css";

export default function Board() {
  const { roomId: ROOM_ID } = useParams();
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [connected, setConnected] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [otherCursors, setOtherCursors] = useState({});
  const [userCount, setUserCount] = useState(1);

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

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e) {
    isDrawing.current = true;
    lastPos.current = getPos(e);
  }

  function handleMouseMove(e) {
    const pos = getPos(e);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cursor", x: pos.x, y: pos.y }));
    }

    if (!isDrawing.current) return;
    const ctx = canvasRef.current.getContext("2d");
    drawLine(ctx, lastPos.current.x, lastPos.current.y, pos.x, pos.y);

    wsRef.current.send(JSON.stringify({
      type: "draw",
      x0: lastPos.current.x, y0: lastPos.current.y,
      x1: pos.x, y1: pos.y,
    }));

    lastPos.current = pos;
  }

  function handleMouseUp() {
    isDrawing.current = false;
  }

  function clearCanvas() {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
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
          <button
            className="clear-btn"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              alert("Link copied!");
            }}
          >
            Copy link
          </button>
          <button className="clear-btn" onClick={clearCanvas}>
            Clear board
          </button>
        </div>
      </header>

      <main className="board-wrap">
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
          <div
            key={id}
            style={{
              position: "absolute",
              left: pos.x,
              top: pos.y,
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ec4899",
              pointerEvents: "none",
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </main>
    </div>
  );
}