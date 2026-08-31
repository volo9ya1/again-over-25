# main.py — FastAPI бэкенд, маршруты WebApp и интеграция Telegram-бота

import asyncio
import os
from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from game_logic import auto_clean_rooms, create_room, rooms

BOT_TOKEN = os.getenv("BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-domain.com/webapp/index.html")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


# --- Pydantic DTO Модели ---
class CreateRoomRequest(BaseModel):
    room_id: str


class RoomRequest(BaseModel):
    room_id: str


class PlayCardRequest(BaseModel):
    room_id: str
    player_id: int
    card_text: str


class SelectWinnerRequest(BaseModel):
    room_id: str
    czar_id: int
    winning_player_id: int


class AddBotRequest(BaseModel):
    room_id: str


class FillBotsRequest(BaseModel):
    room_id: str
    target_count: int = 4


# --- Lifespan приложения ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    clean_task = asyncio.create_task(auto_clean_rooms())
    bot_task = asyncio.create_task(dp.start_polling(bot))
    yield
    clean_task.cancel()
    bot_task.cancel()


app = FastAPI(title="Панчлайн API", lifespan=lifespan)


# --- Эндпоинты API ---
@app.post("/api/room/create")
async def api_create_room(req: CreateRoomRequest):
    room = create_room(req.room_id)
    return {"status": "created", "room_id": room.room_id}


@app.get("/api/room/state")
async def get_room_state(room_id: str, player_id: int):
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    room = rooms[room_id]
    room.process_bot_turns()
    return room.get_state_for_player(player_id)


@app.post("/api/room/play-card")
async def api_play_card(req: PlayCardRequest):
    if req.room_id not in rooms:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    room = rooms[req.room_id]
    success = room.play_card(req.player_id, req.card_text)
    if not success:
        raise HTTPException(
            status_code=400, detail="Нельзя выложить эту карту или вы уже сходили"
        )
    return {"status": "success"}


@app.post("/api/room/select-winner")
async def api_select_winner(req: SelectWinnerRequest):
    if req.room_id not in rooms:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    room = rooms[req.room_id]
    success = room.select_winner(req.czar_id, req.winning_player_id)
    if not success:
        raise HTTPException(
            status_code=400, detail="Неверный хост или выбор победителя"
        )
    return {"status": "success"}


@app.post("/api/room/add-bot")
async def api_add_bot(req: AddBotRequest):
    if req.room_id not in rooms:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    bot_id = rooms[req.room_id].add_bot()
    return {"status": "bot_added", "bot_id": bot_id}


@app.post("/api/room/fill-bots")
async def api_fill_bots(req: FillBotsRequest):
    if req.room_id not in rooms:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    added_count = rooms[req.room_id].fill_with_bots(req.target_count)
    return {"status": "success", "added": added_count}


@app.post("/api/room/start-now")
async def api_start_now(req: RoomRequest):
    if req.room_id not in rooms:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    rooms[req.room_id].start_now()
    return {"status": "started"}


# --- Telegram Бот ---
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🎴 Играть в Панчлайн",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )
            ]
        ]
    )
    await message.answer(
        "Привет! Нажми на кнопку ниже, чтобы открыть карточную игру Панчлайн!",
        reply_markup=keyboard,
    )


# Подключение статических файлов фронтенда WebApp
app.mount("/webapp", StaticFiles(directory="webapp", html=True), name="webapp")
