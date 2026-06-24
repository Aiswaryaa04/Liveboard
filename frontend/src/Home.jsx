import { useNavigate } from "react-router-dom";
import "./App.css";

function generateRoomId() {
  return Math.random().toString(36).substring(2, 9);
}

export default function Home() {
  const navigate = useNavigate();

  function createRoom() {
    const id = generateRoomId();
    navigate(`/room/${id}`);
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          LiveBoard
        </div>
      </div>
      <div style={{ marginTop: "4rem", textAlign: "center" }}>
        <h2 style={{ color: "#292524" }}>Start a new collaborative board</h2>
        <button className="clear-btn" style={{ marginTop: "1rem" }} onClick={createRoom}>
          Create Room
        </button>
      </div>
    </div>
  );
}