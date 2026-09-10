#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор тайлових карт для «ЕХО: НЕОНОВИЙ КУР'ЄР».
Версія 3: рівні 6-8 екранів, два чекпоінти, секретна кімната, вертикальні
відгалуження, моби-передвісники босів і підбирання зброї.

Символи:
  '#' стіна   '=' платформа   '^' шипи   '<' '>' конвеєри
  '@' спавн   '$' чекпоінт    'E' вихід  '+' аптечка  '!' тригер боса
  'I' зброя   '?' дата-лог (секрет)
  вороги: s h t w k d a f p  (велика літера = елітний)
  нові:   r тарано-бот  n ковадло  c дрон-носій  y настінний вузол
          b блінк-щур   m тайл-хробак  1 2 3 конструкти-архіви
"""
import sys

H = 17            # рядків у карті (17*16 = 272 px)
EMPTY = '.'
SOLID = '#'

class Lv:
    def __init__(self, name, theme, w, boss=None, floor=13):
        self.name, self.theme, self.w, self.boss = name, theme, w, boss
        self.floor = floor
        self.g = [[EMPTY]*w for _ in range(H)]
        self.top = [floor]*w          # рядок поверхні для кожної колонки (None = прірва)
        self.mp = []                  # рухомі платформи
        for x in range(w):
            for y in range(floor, H):
                self.g[y][x] = SOLID

    # --- базові примітиви ---
    def set(self, x, y, ch):
        if 0 <= x < self.w and 0 <= y < H:
            self.g[y][x] = ch

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < H:
            return self.g[y][x]
        return SOLID

    def ground(self, x0, x1, row):
        """Суцільна земля з поверхнею на рядку row."""
        for x in range(max(0,x0), min(self.w, x1+1)):
            for y in range(H):
                if y >= row:
                    self.g[y][x] = SOLID
                elif self.g[y][x] == SOLID:
                    self.g[y][x] = EMPTY
            self.top[x] = row

    def pit(self, x0, x1):
        """Прірва — вирізає всю колонку до низу."""
        for x in range(max(0,x0), min(self.w, x1+1)):
            for y in range(H):
                if self.g[y][x] == SOLID:
                    self.g[y][x] = EMPTY
            self.top[x] = None

    def ceil(self, x0, x1, row):
        """Стеля: суцільні блоки від 0 до row включно."""
        for x in range(max(0,x0), min(self.w, x1+1)):
            for y in range(0, row+1):
                self.g[y][x] = SOLID

    def plat(self, x, row, w, ch='='):
        for i in range(w):
            self.set(x+i, row, ch)

    def block(self, x, y, w, h, ch=SOLID):
        for j in range(h):
            for i in range(w):
                self.set(x+i, y+j, ch)

    def spikes(self, x0, x1, row=None):
        for x in range(x0, x1+1):
            r = row if row is not None else (self.top[x]-1 if self.top[x] is not None else None)
            if r is not None:
                self.set(x, r, '^')

    def ent(self, x, ch, row=None, up=1):
        """Ставить сутність на поверхню колонки x (або на заданий рядок)."""
        r = row if row is not None else (self.top[x]-up if self.top[x] is not None else None)
        if r is None:
            raise ValueError('ent над прірвою x=%d' % x)
        self.set(x, r, ch)

    def air(self, x, row, ch):
        self.set(x, row, ch)

    def mplat(self, x, y, w, axis, rng, speed):
        self.mp.append([x, y, w, axis, rng, speed])

    # --- нове у версії 3 ---
    def shaft(self, x0, x1, top, bottom):
        """Вертикальна шахта: прибирає тайли між top і bottom."""
        for x in range(x0, x1 + 1):
            for y in range(top, bottom + 1):
                if self.g[y][x] == SOLID:
                    self.g[y][x] = EMPTY

    def room(self, x0, x1, top, bottom, wall=True):
        """Порожня кімната з підлогою: основа для секретів і відгалужень."""
        for x in range(x0, x1 + 1):
            for y in range(top, bottom + 1):
                self.set(x, y, EMPTY)
            self.set(x, bottom + 1, SOLID)
        if wall:
            for y in range(top, bottom + 2):
                self.set(x0 - 1, y, SOLID)
                self.set(x1 + 1, y, SOLID)
        for x in range(x0 - 1, x1 + 2):
            self.set(x, top - 1, SOLID)

    def secret(self, x0, x1, top, bottom, loot='?'):
        """Секретна кімната: дата-лог/зброя + аптечка."""
        self.room(x0, x1, top, bottom)
        mid = (x0 + x1) // 2
        self.set(mid, bottom, loot)
        self.set(mid + 2, bottom, '+')

    def nook(self, x, row, w, loot='?'):
        """Схованка: платформа-підлога, стеля й стіна праворуч, вхід зліва."""
        self.plat(x, row, w)
        for i in range(w + 1):
            self.set(x + i, row - 5, SOLID)
        for j in range(5):
            self.set(x + w, row - 1 - j, SOLID)
        self.set(x + 1, row - 1, loot)
        self.set(x + w - 2, row - 1, '+')
        # Сходинка на дах схованки. Без неї дах — 5 тайлів (80 px) над
        # підлогою схованки, тобто недосяжна поверхня: валідатор такі
        # «острови» справедливо позначає як помилку рівня.
        if row - 5 > 0 and all(self.get(x - 4 + i, row - 3) != SOLID for i in range(3)):
            self.plat(x - 4, row - 3, 3)

    def stair(self, x, row, n, step=2, w=3, ch='='):
        """Сходинка з платформ угору (для вертикальних відгалужень)."""
        for i in range(n):
            self.plat(x + i * (w + 1), row - i * step, w, ch)

    def rows(self):
        return [''.join(r) for r in self.g]

    # --- перевірки ---
    def check(self):
        errs = []
        rows = self.rows()
        for i, r in enumerate(rows):
            if len(r) != self.w:
                errs.append('%s: рядок %d має довжину %d' % (self.name, i, len(r)))
        if len(rows) != H:
            errs.append('%s: висота %d' % (self.name, len(rows)))
        flat = ''.join(rows)
        for need, what in (('@', 'спавн'), ('$', 'чекпоінт'), ('E', 'вихід')):
            if need not in flat:
                errs.append('%s: немає %s (%s)' % (self.name, what, need))
        # прірви
        x = 0
        while x < self.w:
            if self.top[x] is None:
                x0 = x
                while x < self.w and self.top[x] is None:
                    x += 1
                gap = x - x0
                if gap > 3:
                    errs.append('%s: прірва %d тайлів на x=%d' % (self.name, gap, x0))
            else:
                x += 1
        # уступи
        for x in range(self.w-1):
            a, b = self.top[x], self.top[x+1]
            if a is not None and b is not None and a - b > 2:
                errs.append('%s: уступ %d тайлів на x=%d' % (self.name, a-b, x))
        return errs

    def js(self):
        rows = ',\n  '.join("'" + r + "'" for r in self.rows())
        mp = ','.join('[%d,%d,%d,%r,%d,%d]' % tuple(m) for m in self.mp).replace("'", '"')
        boss = ('"%s"' % self.boss) if self.boss else 'null'
        return ('{n:"%s",th:"%s",boss:%s,mp:[%s],rows:[\n  %s]}' %
                (self.name, self.theme, boss, mp, rows))

# ================================================================= РІВЕНЬ 1
# Нетрі «Іржавий Сектор», 6 екранів. Вчить бігати, стрибати, бити.
# Нові моби: тарано-бот (r) і ковадло (n) — обидва готують до Сервотавра.
L1 = Lv('ІРЖАВИЙ СЕКТОР', 'slum', 180)
L1.pit(14, 15); L1.ground(16, 30, 12)
L1.pit(32, 34); L1.ground(35, 52, 12)
L1.ground(53, 68, 11); L1.pit(70, 71)
L1.ground(72, 92, 12); L1.pit(94, 96)
L1.ground(97, 112, 13); L1.ground(113, 128, 11)
L1.pit(130, 132); L1.ground(133, 150, 12)
L1.pit(152, 153); L1.ground(154, 180, 13)
L1.plat(18, 10, 4); L1.plat(24, 8, 4)
L1.plat(38, 9, 5); L1.plat(46, 10, 4)
L1.stair(56, 9, 3, 2, 3)                      # вертикальне відгалуження вгору
L1.plat(74, 9, 5); L1.plat(82, 7, 4); L1.plat(88, 9, 4)
L1.plat(100, 10, 5); L1.plat(108, 8, 4)
L1.plat(116, 8, 5); L1.plat(124, 6, 4)
L1.plat(136, 9, 5); L1.plat(144, 7, 4)
L1.plat(158, 10, 5); L1.plat(166, 8, 4); L1.plat(172, 10, 4)
L1.nook(64, 7, 6, 'I')                        # СЕКРЕТ: пістолет «Оса»
L1.ent(3, '@')
L1.ent(9, 's'); L1.ent(22, 's'); L1.ent(44, 's'); L1.ent(78, 's'); L1.ent(104, 's')
L1.ent(140, 's'); L1.ent(168, 's')
L1.ent(27, 'h'); L1.ent(60, 'h'); L1.ent(86, 'h'); L1.ent(120, 'h'); L1.ent(160, 'h')
L1.ent(40, 'r'); L1.ent(100, 'r'); L1.ent(146, 'r')     # тарано-боти
L1.ent(66, 'n'); L1.ent(126, 'n'); L1.ent(174, 'n')     # ковадла
L1.air(25, 7, '+'); L1.air(117, 7, '+')
L1.ent(58, '$'); L1.ent(122, '$')             # два чекпоінти
L1.ent(178, 'E')

# ================================================================= РІВЕНЬ 2
# Вантажні доки, 6 екранів + арена СЕРВОТАВРА (останні 30 тайлів).
L2 = Lv('ВАНТАЖНІ ДОКИ', 'docks', 210, boss='servotaur')
L2.pit(16, 18); L2.ground(19, 34, 12)
L2.ground(35, 48, 10); L2.pit(50, 52)
L2.ground(53, 70, 11); L2.ground(71, 86, 13)
L2.pit(88, 90); L2.ground(91, 108, 12)
L2.ground(109, 124, 10); L2.pit(126, 128)
L2.ground(129, 146, 12); L2.pit(148, 149)
L2.ground(150, 168, 13); L2.ground(169, 179, 11)
L2.ground(180, 210, 13)
L2.block(35, 11, 2, 2); L2.block(109, 11, 2, 2)
L2.plat(20, 10, 4); L2.plat(27, 8, 4)
L2.plat(54, 8, 5); L2.plat(62, 9, 4)
L2.plat(74, 10, 5); L2.plat(80, 8, 4)
L2.plat(94, 9, 5); L2.plat(102, 7, 4)
L2.plat(132, 9, 5); L2.plat(140, 7, 4)
L2.plat(152, 10, 5); L2.plat(160, 8, 5)
L2.stair(112, 8, 3, 2, 3)
L2.nook(120, 6, 6, '?')
L2.plat(182, 10, 5); L2.plat(203, 10, 5)      # галереї арени, 48 px над підлогою
L2.ent(3, '@')
L2.ent(11, 's'); L2.ent(30, 's'); L2.ent(66, 's'); L2.ent(98, 's'); L2.ent(155, 's')
L2.ent(24, 'h'); L2.ent(44, 'h'); L2.ent(76, 'h'); L2.ent(116, 'h'); L2.ent(143, 'h'); L2.ent(172, 'h')
L2.air(38, 9, 't'); L2.air(96, 8, 't'); L2.air(136, 8, 't'); L2.air(165, 9, 't')
L2.ent(58, 'r'); L2.ent(106, 'r'); L2.ent(158, 'r')
L2.ent(84, 'n'); L2.ent(146, 'n')
L2.air(28, 7, '+'); L2.air(103, 6, '+'); L2.air(178, 10, '+')
L2.ent(60, '$'); L2.ent(140, '$')
L2.ent(180, '!')
L2.ent(207, 'E')

# ================================================================= РІВЕНЬ 3
# Дахи, 7 екранів. Нові моби: дрон-носій (c) і настінний вузол (y) —
# вчать пріоритету цілей перед Маткою-Роєм.
L3 = Lv('ДАХИ СЕКТОРА', 'roofs', 200)
L3.ground(0, 12, 12); L3.pit(13, 15)
L3.ground(16, 28, 11); L3.pit(29, 31)
L3.ground(32, 44, 12); L3.pit(45, 47)
L3.ground(48, 62, 10); L3.pit(63, 65)
L3.ground(66, 80, 11); L3.ground(81, 94, 9)
L3.pit(95, 97); L3.ground(98, 114, 10)
L3.pit(116, 118); L3.ground(119, 134, 12)
L3.ground(135, 150, 10); L3.pit(152, 154)
L3.ground(155, 172, 11); L3.pit(174, 175)
L3.ground(176, 200, 12)
L3.plat(18, 8, 4); L3.plat(34, 9, 4); L3.plat(52, 7, 4)
L3.plat(70, 8, 4); L3.plat(84, 6, 4); L3.plat(102, 7, 5)
L3.plat(122, 9, 5); L3.plat(138, 7, 4); L3.plat(158, 8, 4)
L3.plat(180, 9, 5); L3.plat(190, 7, 4)
L3.stair(106, 8, 3, 2, 3)
L3.nook(74, 6, 6, 'I')                        # СЕКРЕТ: електрохлист
L3.mplat(45, 12, 3, 'h', 3, 34)
L3.mplat(116, 9, 3, 'v', 4, 30)
L3.ent(3, '@')
L3.ent(9, 'h'); L3.ent(38, 'h'); L3.ent(56, 'H'); L3.ent(90, 'h'); L3.ent(128, 'H'); L3.ent(165, 'h')
L3.air(22, 6, 'k'); L3.air(60, 5, 'k'); L3.air(110, 6, 'k'); L3.air(168, 5, 'k')
L3.air(50, 6, 'w'); L3.air(126, 5, 'w'); L3.air(186, 6, 'w')
L3.air(44, 5, 'c'); L3.air(108, 4, 'c'); L3.air(160, 5, 'c')   # дрони-носії
L3.ent(72, 'y'); L3.ent(130, 'y'); L3.ent(178, 'y')            # настінні вузли
L3.air(85, 4, '+'); L3.air(140, 5, '+')
L3.ent(66, '$'); L3.ent(136, '$')
L3.ent(197, 'E')

# ================================================================= РІВЕНЬ 4
# Фабрика дронів, 6 екранів + арена МАТКИ-РОЮ.
L4 = Lv('ФАБРИКА ДРОНІВ', 'factory', 210, boss='queen')
L4.ground(0, 20, 13); L4.pit(21, 23)
L4.ground(24, 40, 12); L4.ground(41, 54, 10)
L4.pit(56, 58); L4.ground(59, 76, 11)
L4.ground(77, 92, 13); L4.pit(94, 96)
L4.ground(97, 114, 12); L4.pit(116, 118)
L4.ground(119, 136, 11); L4.ground(137, 152, 13)
L4.pit(154, 156); L4.ground(157, 179, 12)
L4.ground(180, 210, 13)
L4.plat(26, 9, 5); L4.plat(44, 7, 5); L4.plat(62, 8, 5)
L4.plat(80, 10, 5); L4.plat(100, 9, 5); L4.plat(122, 8, 5)
L4.plat(140, 10, 5); L4.plat(160, 9, 5); L4.plat(170, 7, 4)
L4.stair(128, 9, 3, 2, 3)
L4.nook(46, 5, 6, '?')
L4.mplat(21, 12, 3, 'h', 3, 36)
L4.plat(183, 11, 5); L4.plat(189, 9, 5); L4.plat(196, 9, 5); L4.plat(202, 11, 5)
L4.ceil(0, 210, 1)
L4.ent(3, '@')
L4.air(14, 2, 'p'); L4.air(48, 2, 'p'); L4.air(86, 2, 'p'); L4.air(124, 2, 'P'); L4.air(166, 2, 'p')
L4.air(18, 7, 'w'); L4.air(34, 6, 'w'); L4.air(52, 5, 'w'); L4.air(70, 6, 'W')
L4.air(104, 6, 'w'); L4.air(132, 5, 'W'); L4.air(174, 6, 'w')
L4.ent(30, 's'); L4.ent(66, 's'); L4.ent(110, 's'); L4.ent(148, 's')
L4.air(90, 5, 'c'); L4.air(144, 5, 'c')
L4.ent(84, 'y'); L4.ent(152, 'y')
L4.air(45, 6, '+'); L4.air(163, 8, '+'); L4.air(178, 10, '+')
L4.ent(60, '$'); L4.ent(140, '$')
L4.ent(180, '!')
L4.ent(207, 'E')

# ================================================================= РІВЕНЬ 5
# Занедбане метро, 7 екранів. Нові моби: блінк-щур (b) і клинковий адепт (a) —
# вчать парирування й телепортів перед Хроноклинком.
L5 = Lv('ЗАНЕДБАНЕ МЕТРО', 'metro', 200)
L5.ground(0, 28, 13); L5.pit(29, 31)
L5.ground(32, 48, 12); L5.pit(50, 52)
L5.ground(53, 70, 13); L5.ground(71, 86, 11)
L5.pit(88, 89); L5.ground(90, 108, 12)
L5.pit(110, 112); L5.ground(113, 130, 13)
L5.ground(131, 146, 11); L5.pit(148, 150)
L5.ground(151, 168, 12); L5.pit(170, 171)
L5.ground(172, 200, 13)
L5.plat(16, 10, 4); L5.plat(36, 9, 4); L5.plat(56, 10, 5)
L5.plat(74, 8, 4); L5.plat(94, 9, 5); L5.plat(116, 10, 5)
L5.plat(134, 8, 4); L5.plat(154, 9, 5); L5.plat(176, 10, 5); L5.plat(186, 8, 4)
L5.stair(120, 10, 3, 2, 3)
L5.nook(100, 6, 6, 'I')                       # СЕКРЕТ: дробовик «Картеч»
L5.ceil(0, 200, 2); L5.ceil(32, 48, 4); L5.ceil(90, 108, 4)
L5.ent(3, '@')
L5.ent(12, 's'); L5.ent(22, 's'); L5.ent(42, 'S'); L5.ent(62, 's'); L5.ent(96, 's')
L5.ent(122, 'S'); L5.ent(160, 's'); L5.ent(190, 'S')
L5.ent(26, 'h'); L5.ent(58, 'h'); L5.ent(104, 'H'); L5.ent(140, 'h'); L5.ent(180, 'H')
L5.ent(46, 'b'); L5.ent(84, 'b'); L5.ent(128, 'b'); L5.ent(166, 'b')   # блінк-щури
L5.ent(66, 'a'); L5.ent(126, 'a'); L5.ent(184, 'a')                    # клинкові адепти
L5.air(57, 8, '+'); L5.air(155, 7, '+')
L5.ent(70, '$'); L5.ent(142, '$')
L5.ent(197, 'E')

# ================================================================= РІВЕНЬ 6
# Сад-храм, 6 екранів + арена ХРОНОКЛИНКА.
L6 = Lv('САД-ХРАМ КАЙЗЕН', 'garden', 210, boss='chrono')
L6.pit(17, 19); L6.ground(20, 36, 12)
L6.ground(37, 50, 10); L6.pit(52, 54)
L6.ground(55, 72, 11); L6.ground(73, 88, 13)
L6.pit(90, 92); L6.ground(93, 110, 12)
L6.ground(111, 126, 10); L6.pit(128, 130)
L6.ground(131, 148, 11); L6.pit(150, 151)
L6.ground(152, 179, 12); L6.ground(180, 210, 13)
L6.block(37, 11, 2, 2); L6.block(111, 11, 2, 2)
L6.plat(22, 9, 4); L6.plat(40, 7, 5); L6.plat(58, 8, 4)
L6.plat(76, 10, 5); L6.plat(96, 9, 5); L6.plat(114, 7, 5)
L6.plat(134, 8, 5); L6.plat(155, 9, 5); L6.plat(168, 7, 4)
L6.plat(163, 9, 4)                            # сходинка до plat(168,7): інакше острів
L6.stair(100, 9, 3, 2, 3)
L6.nook(60, 5, 6, '?')
L6.ent(3, '@')
L6.ent(10, 'a'); L6.ent(30, 'a'); L6.ent(46, 'A'); L6.ent(66, 'a'); L6.ent(84, 'A')
L6.ent(104, 'a'); L6.ent(122, 'A'); L6.ent(160, 'a'); L6.ent(174, 'A')
L6.ent(26, 'h'); L6.ent(80, 'h'); L6.ent(140, 'h')
L6.ent(56, 'b'); L6.ent(118, 'b'); L6.ent(166, 'b')
L6.air(41, 6, '+'); L6.air(137, 7, '+'); L6.air(178, 10, '+')
L6.ent(72, '$'); L6.ent(144, '$')
L6.ent(180, '!')
L6.ent(207, 'E')

# ================================================================= РІВЕНЬ 7
# Серверна ферма, 7 екранів. Нові моби: тайл-хробак (m) і фантом (f) —
# вчать мінливої арени перед Гліч-Ядром.
L7 = Lv('СЕРВЕРНА ФЕРМА', 'server', 210)
L7.ground(0, 22, 13); L7.pit(23, 25)
L7.ground(26, 44, 12); L7.ground(45, 60, 10)
L7.pit(62, 64); L7.ground(65, 84, 11)
L7.ground(85, 100, 13); L7.pit(102, 104)
L7.ground(105, 124, 12); L7.pit(126, 128)
L7.ground(129, 132, 11); L7.ground(133, 146, 10); L7.ground(147, 164, 12)
L7.pit(166, 168); L7.ground(169, 186, 13)
L7.pit(188, 189); L7.ground(190, 210, 12)
L7.plat(28, 9, 5); L7.plat(48, 7, 5); L7.plat(68, 8, 5)
L7.plat(88, 10, 5); L7.plat(108, 9, 5); L7.plat(132, 7, 5)
L7.plat(150, 9, 5); L7.plat(172, 10, 5); L7.plat(194, 9, 5)
L7.stair(112, 9, 3, 2, 3)
L7.nook(76, 5, 6, 'I')                        # СЕКРЕТ: плазмові кігті
L7.ceil(0, 210, 1)
for a, b in ((10, 16), (34, 40), (72, 78), (116, 122), (156, 162), (198, 204)):
    for x in range(a, b + 1):
        L7.set(x, L7.top[x], '>' if (a // 7) % 2 == 0 else '<')
L7.spikes(52, 53, 9); L7.spikes(56, 57, 9)
L7.spikes(94, 95); L7.spikes(98, 99)
L7.ent(3, '@')
L7.air(20, 2, 'p'); L7.air(42, 2, 'p'); L7.air(58, 2, 'P'); L7.air(82, 2, 'p')
L7.air(110, 2, 'p'); L7.air(140, 2, 'P'); L7.air(180, 2, 'p')
L7.ent(36, 'd'); L7.ent(70, 'd'); L7.ent(96, 'D'); L7.ent(120, 'd'); L7.ent(158, 'D'); L7.ent(196, 'd')
L7.air(30, 8, 't'); L7.air(109, 8, 't'); L7.air(174, 9, 't')
L7.ent(66, 'm'); L7.ent(118, 'm'); L7.ent(176, 'm')            # тайл-хробаки
L7.ent(90, 'f'); L7.ent(152, 'f')                              # фантоми-копії
L7.air(49, 6, '+'); L7.air(173, 9, '+')
L7.ent(86, '$'); L7.ent(148, '$')
L7.ent(207, 'E')

# ================================================================= РІВЕНЬ 8
# Віртуальний простір, 6 екранів + арена ГЛІЧ-ЯДРА.
L8 = Lv('ВІРТУАЛЬНИЙ ПРОСТІР', 'virtual', 210, boss='glitch')
L8.pit(15, 17); L8.ground(18, 32, 11)
L8.pit(34, 36); L8.ground(37, 52, 13)
L8.ground(53, 66, 11); L8.ground(67, 80, 10)
L8.pit(82, 84); L8.ground(85, 102, 12)
L8.pit(104, 106); L8.ground(107, 124, 11)
L8.ground(125, 140, 13); L8.pit(142, 144)
L8.ground(145, 162, 12); L8.pit(164, 165)
L8.ground(166, 179, 11); L8.ground(180, 210, 13)
L8.plat(20, 8, 4); L8.plat(40, 10, 4); L8.plat(46, 8, 4)
L8.plat(58, 8, 4); L8.plat(70, 7, 5); L8.plat(88, 9, 5)
L8.plat(110, 8, 5); L8.plat(128, 10, 5); L8.plat(148, 9, 5); L8.plat(170, 8, 4)
L8.stair(92, 9, 3, 2, 3)
L8.nook(114, 5, 6, '?')
L8.plat(185, 11, 5); L8.plat(196, 11, 5)
L8.ceil(180, 210, 1)
L8.ent(3, '@')
L8.ent(10, 'f'); L8.ent(30, 'f'); L8.ent(62, 'F'); L8.ent(96, 'f'); L8.ent(134, 'F'); L8.ent(172, 'f')
L8.ent(24, 's'); L8.ent(44, 's'); L8.ent(50, 'S'); L8.ent(92, 's'); L8.ent(120, 'S'); L8.ent(158, 's')
L8.ent(56, 'm'); L8.ent(112, 'm'); L8.ent(154, 'm')
L8.ent(76, 'b'); L8.ent(138, 'b')
L8.air(21, 7, '+'); L8.air(129, 9, '+'); L8.air(178, 9, '+')
L8.ent(70, '$'); L8.ent(146, '$')
L8.ent(180, '!')
L8.ent(207, 'E')

# ================================================================= РІВЕНЬ 9
# Шпиль корпорації, 8 екранів. Конструкти-архіви (1 2 3) — по одній
# ослабленій атаці кожного попереднього боса.
L9 = Lv('ШПИЛЬ КАЙЗЕН-ВОЛЬТ', 'spire', 240)
L9.ground(0, 14, 13); L9.pit(15, 17)
L9.ground(18, 32, 12); L9.pit(33, 35)
L9.ground(36, 50, 11); L9.pit(52, 54)
L9.ground(55, 70, 13); L9.ground(71, 84, 11)
L9.pit(86, 88); L9.ground(89, 104, 12)
L9.pit(106, 108); L9.ground(109, 122, 11)
L9.ground(123, 138, 10); L9.pit(140, 142)
L9.ground(143, 160, 12); L9.pit(162, 164)
L9.ground(165, 182, 11); L9.ground(183, 198, 13)
L9.pit(200, 202); L9.ground(203, 220, 12)
L9.pit(222, 223); L9.ground(224, 240, 13)
L9.plat(20, 9, 4); L9.plat(38, 8, 4); L9.plat(58, 10, 4)
L9.plat(74, 8, 4); L9.plat(92, 9, 4); L9.plat(112, 8, 4)
L9.plat(126, 7, 5); L9.plat(146, 9, 5); L9.plat(168, 8, 5)
L9.plat(186, 10, 5); L9.plat(206, 9, 5); L9.plat(228, 10, 5)
L9.stair(150, 9, 3, 2, 3)
L9.nook(210, 6, 6, '?')
L9.mplat(33, 13, 3, 'h', 3, 38)
L9.mplat(86, 10, 3, 'v', 3, 34)
L9.mplat(162, 12, 3, 'h', 3, 40)
L9.ent(3, '@')
L9.ent(11, 'H'); L9.ent(46, 'H'); L9.ent(100, 'H'); L9.ent(158, 'H'); L9.ent(216, 'H')
L9.ent(28, 'A'); L9.ent(66, 'a'); L9.ent(118, 'A'); L9.ent(176, 'A'); L9.ent(234, 'A')
L9.ent(80, 'D'); L9.ent(136, 'd'); L9.ent(196, 'D')
L9.air(42, 6, 'W'); L9.air(96, 5, 'w'); L9.air(154, 5, 'W'); L9.air(212, 6, 'W')
L9.air(60, 6, 'K'); L9.air(130, 5, 'k'); L9.air(190, 5, 'K')
L9.air(24, 7, 'T'); L9.air(114, 6, 'T'); L9.air(172, 7, 'T')
L9.ent(70, 'F'); L9.ent(180, 'f')
L9.ent(50, '1'); L9.ent(124, '2'); L9.ent(206, '3')     # конструкти-архіви
L9.ent(104, '2'); L9.ent(230, '1')
L9.air(93, 5, '+'); L9.air(187, 8, '+'); L9.air(21, 7, '+')
L9.ent(84, '$'); L9.ent(166, '$')
L9.ent(237, 'E')

# ================================================================ РІВЕНЬ 10
# Ядро «Архітектора»: підхід 5 екранів + велика фінальна арена.
L10 = Lv('ЯДРО АРХІТЕКТОРА', 'core', 180, boss='architect')
L10.ground(0, 16, 13); L10.pit(18, 20)
L10.ground(21, 38, 12); L10.pit(40, 42)
L10.ground(43, 60, 11); L10.ground(61, 76, 13)
L10.pit(78, 80); L10.ground(81, 98, 12)
L10.pit(100, 102); L10.ground(103, 120, 11)
L10.ground(121, 149, 13); L10.ground(150, 180, 13)
L10.plat(23, 9, 5); L10.plat(46, 8, 5); L10.plat(64, 10, 5)
L10.plat(84, 9, 5); L10.plat(106, 8, 5); L10.plat(128, 10, 5)
L10.stair(110, 8, 3, 2, 3)
L10.nook(90, 6, 6, '?')
L10.plat(156, 11, 5); L10.plat(168, 11, 5)
L10.ceil(0, 180, 1)
L10.ent(3, '@')
L10.ent(12, 'D'); L10.ent(34, 'A'); L10.ent(56, 'D'); L10.ent(74, 'A'); L10.ent(112, 'D'); L10.ent(140, 'A')
L10.air(28, 7, 'T'); L10.air(96, 7, 'T')
L10.air(38, 6, 'K'); L10.air(88, 6, 'W'); L10.air(118, 5, 'K')
L10.ent(50, '1'); L10.ent(94, '2'); L10.ent(132, '3')
L10.air(47, 6, '+'); L10.air(129, 8, '+'); L10.air(146, 11, '+')
L10.ent(66, '$'); L10.ent(124, '$')
L10.ent(150, '!')
L10.ent(177, 'E')


LEVELS = [L1, L2, L3, L4, L5, L6, L7, L8, L9, L10]

def main():
    bad = 0
    for lv in LEVELS:
        errs = lv.check()
        # додаткова перевірка: висота приземлення після прірви
        x = 0
        while x < lv.w:
            if lv.top[x] is None:
                x0 = x
                while x < lv.w and lv.top[x] is None:
                    x += 1
                a = lv.top[x0-1] if x0 > 0 else None
                b = lv.top[x] if x < lv.w else None
                if a is not None and b is not None and a - b > 2:
                    errs.append('%s: приземлення на %d тайлів вище через прірву на x=%d'
                                % (lv.name, a-b, x0))
            else:
                x += 1
        for e in errs:
            bad += 1
            print('ПОМИЛКА ' + e, file=sys.stderr)
    if bad:
        print('\n%d проблем(и)' % bad, file=sys.stderr)
        sys.exit(1)
    out = ['const LEVELS=[']
    out.append(',\n'.join(lv.js() for lv in LEVELS))
    out.append('];')
    print('\n'.join(out))

if __name__ == '__main__':
    main()
