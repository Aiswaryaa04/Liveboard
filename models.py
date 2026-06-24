from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from sqlalchemy.sql import func
from database import Base

class Stroke(Base):
    __tablename__ = "strokes"
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(String, index=True, nullable=False)
    x0 = Column(Float, nullable=False)
    y0 = Column(Float, nullable=False)
    x1 = Column(Float, nullable=False)
    y1 = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BoardElement(Base):
    __tablename__ = "board_elements"
    id = Column(String, primary_key=True, index=True)  # client-generated ID (e.g. note id)
    room_id = Column(String, index=True, nullable=False)
    type = Column(String, nullable=False)  # "rect" | "note"
    data = Column(Text, nullable=False)  # JSON-encoded element fields
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())