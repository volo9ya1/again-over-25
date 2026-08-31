# game_logic.py — Логика комнат, ботов, таймеров и игрового процесса

import asyncio
import random
import time
from typing import Dict, List, Optional

from cards import ANSWERS, QUESTIONS

MAX_ROOMS = 20
ROOM_TIMEOUT = 900  # 15 минут неактивности (в секундах)


class Room:

    def __init__(self, room_id: str):
        self.room_id = room_id
        self.players: List[int] = []  # Список Telegram ID участников
        self.czar_index: int = 0  # Индекс текущего ведущего
        self.scores: Dict[int, int] = {}  # Очки игроков
        self.hands: Dict[int, List[str]] = {}  # Карты на руках
        self.table_cards: List[dict] = []  # Карты, скинутые на стол в раунде

        # Настройки лобби и старта
        self.created_at = time.time()
        self.lobby_duration = 60  # 1 минута на сбор участников
        self.is_started = False

        # Перемешиваем колоды
        self.questions_deck = QUESTIONS.copy()
        random.shuffle(self.questions_deck)
        self.answers_deck = ANSWERS.copy()
        random.shuffle(self.answers_deck)

        self.current_question: Optional[str] = (
            self.questions_deck.pop() if self.questions_deck else ""
        )
        self.last_activity = time.time()

    def add_player(self, player_id: int):
        """Добавление игрока в комнату и выдача стартовых карт"""
        self.last_activity = time.time()
        if player_id not in self.players:
            self.players.append(player_id)
            self.scores[player_id] = 0
            self.hands[player_id] = []
            self.refill_hand(player_id)

    def add_bot(self) -> int:
        """Добавление бота с отрицательным ID"""
        bot_id = -len([p for p in self.players if p < 0]) - 1
        self.add_player(bot_id)
        return bot_id

    def fill_with_bots(self, target_count: int = 4) -> int:
        """Добирает ботов до указанного целевого количества игроков"""
        added = 0
        while len(self.players) < target_count:
            self.add_bot()
            added += 1
        return added

    def refill_hand(self, player_id: int):
        """Добор карт до 5 штук на руку"""
        while len(self.hands[player_id]) < 5:
            if not self.answers_deck:
                self.answers_deck = ANSWERS.copy()
                random.shuffle(self.answers_deck)
            self.hands[player_id].append(self.answers_deck.pop())

    def get_lobby_time_left(self) -> int:
        """Остаток времени таймера лобби в секундах"""
        elapsed = time.time() - self.created_at
        return max(0, int(self.lobby_duration - elapsed))

    def start_now(self):
        """Принудительный старт игры (скип таймера)"""
        self.is_started = True

    def play_card(self, player_id: int, card_text: str) -> bool:
        """Сброс карты игроком"""
        self.last_activity = time.time()

        if self.get_czar_id() == player_id:
            return False

        if any(item["player_id"] == player_id for item in self.table_cards):
            return False

        if card_text in self.hands.get(player_id, []):
            self.hands[player_id].remove(card_text)
            self.table_cards.append({"player_id": player_id, "card": card_text})
            return True
        return False

    def select_winner(self, czar_id: int, winning_player_id: int) -> bool:
        """Выбор победителя раунда ведущим"""
        self.last_activity = time.time()

        if self.get_czar_id() != czar_id:
            return False

        if winning_player_id in self.scores:
            self.scores[winning_player_id] += 1
            self.next_round()
            return True
        return False

    def next_round(self):
        """Переход к следующему раунду"""
        self.table_cards.clear()

        if self.players:
            self.czar_index = (self.czar_index + 1) % len(self.players)

        if not self.questions_deck:
            self.questions_deck = QUESTIONS.copy()
            random.shuffle(self.questions_deck)

        self.current_question = (
            self.questions_deck.pop() if self.questions_deck else ""
        )

        for p_id in self.players:
            self.refill_hand(p_id)

    def process_bot_turns(self):
        """Автоматические ходы ботов"""
        czar_id = self.get_czar_id()

        # 1. Боты-игроки сбрасывают случайную карту
        for p_id in self.players:
            if p_id < 0 and p_id != czar_id:
                has_submitted = any(
                    item["player_id"] == p_id for item in self.table_cards
                )
                if not has_submitted and self.hands.get(p_id):
                    bot_card = random.choice(self.hands[p_id])
                    self.play_card(p_id, bot_card)

        # 2. Если Ведущий — бот, он выбирает победителя после сброса всех карт
        expected_cards = len(self.players) - 1
        if (
            czar_id < 0
            and len(self.table_cards) >= expected_cards
            and expected_cards > 0
        ):
            winning_item = random.choice(self.table_cards)
            self.select_winner(czar_id, winning_item["player_id"])

    def get_czar_id(self) -> Optional[int]:
        """Получение Telegram ID текущего ведущего"""
        if not self.players:
            return None
        return self.players[self.czar_index]

    def get_state_for_player(self, player_id: int) -> dict:
        """Формирование состояния комнаты для отправки в WebApp"""
        self.add_player(player_id)

        time_left = self.get_lobby_time_left()
        # Автоматический старт при истечении таймера, если есть хотя бы 2 игрока
        if not self.is_started and time_left == 0 and len(self.players) >= 2:
            self.is_started = True

        is_czar = self.get_czar_id() == player_id

        visible_table = []
        for item in self.table_cards:
            visible_table.append(
                {
                    "card": item["card"],
                    "player_id": item["player_id"] if is_czar else None,
                }
            )

        return {
            "room_id": self.room_id,
            "question": self.current_question,
            "is_czar": is_czar,
            "czar_id": self.get_czar_id(),
            "my_hand": self.hands.get(player_id, []),
            "submitted_count": len(self.table_cards),
            "table_cards": visible_table,
            "scores": self.scores,
            "player_count": len(self.players),
            "is_started": self.is_started,
            "lobby_time_left": time_left,
        }


rooms: Dict[str, Room] = {}


def create_room(room_id: str) -> Room:
    if len(rooms) >= MAX_ROOMS:
        oldest_key = min(rooms, key=lambda k: rooms[k].last_activity)
        del rooms[oldest_key]

    rooms[room_id] = Room(room_id)
    return rooms[room_id]


async def auto_clean_rooms():
    while True:
        await asyncio.sleep(60)
        now = time.time()
        expired = [
            r_id
            for r_id, room in rooms.items()
            if now - room.last_activity > ROOM_TIMEOUT
        ]
        for r_id in expired:
            del rooms[r_id]
