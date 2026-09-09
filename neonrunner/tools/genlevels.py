#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор тайлових карт для «ЕХО: НЕОНОВИЙ КУР'ЄР».
Малює рівні з компактного опису й друкує готовий JS-масив рядків,
який вставляється в index.html. Тут же — базові перевірки геометрії:
  * ширина всіх рядків однакова;
  * прірви <= 3 тайли (48 px) і мають розгін;
  * підйом уступом <= 2 тайли (32 px).
Фізика: стрибок 48 px (3 тайли), довжина стрибка ~61 px (3.8 тайла).
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

# ---------------------------------------------------------------- РІВЕНЬ 1
# Нетрі «Іржавий Сектор»: дощ, неон, пологий старт. Вчить бігати й стрибати.
L1 = Lv('ІРЖАВИЙ СЕКТОР', 'slum', 90)
L1.pit(12, 13)
L1.pit(26, 27)
L1.ground(28, 44, 12)
L1.pit(46, 48)
L1.ground(49, 62, 12)
L1.ground(63, 74, 11)
L1.pit(76, 77)
L1.ground(78, 89, 12)
L1.plat(16, 10, 4); L1.plat(21, 8, 3)
L1.plat(32, 9, 4); L1.plat(38, 10, 3)
L1.plat(53, 9, 5)
L1.plat(66, 8, 4)
L1.plat(80, 9, 4)
L1.ent(3, '@')
L1.ent(8, 's'); L1.ent(20, 's'); L1.ent(42, 's'); L1.ent(58, 's'); L1.ent(84, 's')
L1.ent(33, 'h'); L1.ent(56, 'h'); L1.ent(70, 'h'); L1.ent(82, 'h')
L1.air(17, 9, '+'); L1.air(67, 7, '+')
L1.ent(45, '$')
L1.ent(87, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 2
# Вантажні доки + арена СЕРВОТАВРА (останні 30 тайлів).
L2 = Lv('ВАНТАЖНІ ДОКИ', 'docks', 120, boss='servotaur')
L2.pit(14, 16)
L2.ground(17, 30, 12)
L2.ground(31, 40, 10)
L2.pit(42, 44)
L2.ground(45, 58, 11)
L2.ground(59, 70, 13)
L2.pit(72, 74)
L2.ground(75, 89, 12)
L2.ground(90, 120, 13)
L2.block(31, 11, 2, 2); L2.block(52, 9, 3, 2)
L2.plat(18, 10, 4); L2.plat(24, 8, 4)
L2.plat(46, 8, 4); L2.plat(62, 10, 4); L2.plat(66, 8, 3)
L2.plat(78, 9, 5); L2.plat(85, 7, 4)
# --- арена СЕРВОТАВРА (тайли 90..119) ---
# Підлога рівна по всій ширині; центр 97..112 = 16 тайлів = 256 px вільні.
# Дві бічні галереї рівно на 48 px над підлогою (208 - 160): один стрибок.
L2.plat(92, 10, 5); L2.plat(113, 10, 5)
L2.ent(3, '@')
L2.ent(10, 's'); L2.ent(28, 's'); L2.ent(64, 's'); L2.ent(80, 's')
L2.ent(22, 'h'); L2.ent(36, 'h'); L2.ent(56, 'h'); L2.ent(68, 'h'); L2.ent(84, 'h')
L2.air(33, 9, 't'); L2.air(54, 8, 't'); L2.air(79, 8, 't')
L2.air(25, 7, '+'); L2.air(86, 6, '+')
L2.ent(59, '$')
L2.air(88, 11, '+')
L2.ent(90, '!')
L2.ent(117, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 3
# Дахи: рухомі платформи-ліфти, вітрові вентилятори, камікадзе.
L3 = Lv('ДАХИ СЕКТОРА', 'roofs', 120)
L3.ground(0, 10, 12)
L3.pit(11, 13)
L3.ground(14, 24, 11)
L3.pit(25, 27)
L3.ground(28, 36, 12)
L3.pit(37, 39)
L3.ground(40, 52, 10)
L3.pit(53, 55)
L3.ground(56, 68, 11)
L3.ground(69, 80, 9)
L3.pit(81, 83)
L3.ground(84, 96, 10)
L3.pit(97, 99)
L3.ground(100, 120, 12)
L3.plat(16, 8, 4); L3.plat(30, 9, 4); L3.plat(44, 7, 4)
L3.plat(58, 8, 4); L3.plat(72, 6, 4); L3.plat(88, 7, 4)
L3.plat(104, 9, 4); L3.plat(110, 7, 4)
L3.mplat(37, 12, 3, 'h', 3, 34)
L3.mplat(81, 9, 3, 'v', 4, 30)
L3.ent(3, '@')
L3.ent(8, 'h'); L3.ent(33, 'h'); L3.ent(50, 'H'); L3.ent(64, 'h'); L3.ent(92, 'H')
L3.air(20, 6, 'k'); L3.air(48, 5, 'k'); L3.air(76, 5, 'k'); L3.air(106, 6, 'k')
L3.air(60, 6, 'w'); L3.air(90, 5, 'w')
L3.air(45, 6, '+'); L3.air(105, 8, '+')
L3.ent(60, '$')
L3.ent(117, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 4
# Фабрика дронів + арена МАТКИ-РОЮ.
L4 = Lv('ФАБРИКА ДРОНІВ', 'factory', 120, boss='queen')
L4.ground(0, 18, 13)
L4.pit(19, 21)
L4.ground(22, 36, 12)
L4.ground(37, 48, 10)
L4.pit(50, 52)
L4.ground(53, 66, 11)
L4.ground(67, 78, 13)
L4.pit(80, 82)
L4.ground(83, 89, 12)
L4.ground(90, 120, 13)
L4.ceil(0, 120, 1)
# сходинки арени: з підлоги (208) на 176, звідти на 144 — обидва стрибки по 32 px
L4.plat(93, 11, 5); L4.plat(99, 9, 5); L4.plat(106, 9, 5); L4.plat(112, 11, 5)
L4.plat(24, 9, 4); L4.plat(40, 7, 4); L4.plat(56, 8, 5); L4.plat(70, 10, 4)
L4.plat(84, 9, 4)
L4.mplat(19, 12, 3, 'h', 3, 36)
L4.ent(3, '@')
L4.air(12, 2, 'p'); L4.air(44, 2, 'p'); L4.air(74, 2, 'p'); L4.air(86, 2, 'P')
L4.air(16, 7, 'w'); L4.air(30, 6, 'w'); L4.air(46, 5, 'w'); L4.air(62, 6, 'W')
L4.air(76, 6, 'w'); L4.air(88, 5, 'W')
L4.ent(28, 's'); L4.ent(60, 's'); L4.ent(72, 's')
L4.air(41, 6, '+'); L4.air(85, 8, '+')
L4.ent(58, '$')
L4.ent(90, '!')
L4.ent(117, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 5
# Занедбане метро: темрява, ліхтар, сліпі мутанти (глухі до всього, крім шуму).
L5 = Lv('ЗАНЕДБАНЕ МЕТРО', 'metro', 120)
L5.ground(0, 26, 13)
L5.pit(27, 29)
L5.ground(30, 44, 12)
L5.pit(46, 48)
L5.ground(49, 64, 13)
L5.ground(65, 78, 11)
L5.pit(80, 81)
L5.ground(82, 98, 12)
L5.pit(100, 102)
L5.ground(103, 120, 13)
L5.ceil(0, 120, 2)
L5.ceil(30, 44, 4)
L5.ceil(65, 78, 3)
L5.plat(14, 10, 4); L5.plat(34, 9, 4); L5.plat(52, 10, 5); L5.plat(70, 8, 4)
L5.plat(86, 9, 4); L5.plat(106, 10, 4); L5.plat(112, 8, 4)
L5.ent(3, '@')
L5.ent(11, 's'); L5.ent(20, 's'); L5.ent(38, 'S'); L5.ent(56, 's'); L5.ent(60, 's')
L5.ent(88, 'S'); L5.ent(108, 's'); L5.ent(115, 'S')
L5.ent(24, 'h'); L5.ent(42, 'h'); L5.ent(74, 'H'); L5.ent(95, 'h'); L5.ent(112, 'H')
L5.air(53, 8, '+'); L5.air(87, 7, '+')
L5.ent(62, '$')
L5.ent(118, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 6
# Корпоративний сад-храм + арена ХРОНОКЛИНКА.
L6 = Lv('САД-ХРАМ КАЙЗЕН', 'garden', 120, boss='chrono')
L6.pit(15, 17)
L6.ground(18, 32, 12)
L6.ground(33, 44, 10)
L6.pit(46, 48)
L6.ground(49, 62, 11)
L6.ground(63, 74, 13)
L6.pit(76, 78)
L6.ground(79, 89, 12)
L6.ground(90, 120, 13)
L6.plat(20, 9, 4); L6.plat(36, 7, 5); L6.plat(52, 8, 4); L6.plat(66, 10, 4)
L6.plat(82, 9, 4)
L6.block(33, 11, 2, 2); L6.block(63, 12, 2, 1)
L6.ent(3, '@')
L6.ent(9, 'a'); L6.ent(26, 'a'); L6.ent(40, 'A'); L6.ent(56, 'a'); L6.ent(70, 'A')
L6.ent(85, 'a'); L6.ent(88, 'A')
L6.ent(22, 'h'); L6.ent(66, 'h')
L6.air(37, 6, '+'); L6.air(83, 8, '+')
L6.ent(63, '$')
L6.ent(90, '!')
L6.ent(117, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 7
# Серверна ферма: конвеєри, гарячі труби (шкода), щитоносці й павуки.
L7 = Lv('СЕРВЕРНА ФЕРМА', 'server', 150)
L7.ground(0, 20, 13)
L7.pit(21, 23)
L7.ground(24, 40, 12)
L7.ground(41, 54, 10)
L7.pit(56, 58)
L7.ground(59, 76, 11)
L7.ground(77, 92, 13)
L7.pit(94, 96)
L7.ground(97, 114, 12)
L7.pit(116, 118)
L7.ground(119, 150, 13)
L7.ceil(0, 150, 1)
L7.plat(26, 9, 5); L7.plat(44, 7, 5); L7.plat(62, 8, 5); L7.plat(80, 10, 5)
L7.plat(100, 9, 5); L7.plat(122, 10, 4); L7.plat(130, 8, 4); L7.plat(140, 10, 4)
for a, b in ((8, 14), (30, 36), (66, 72), (104, 110), (134, 139)):
    for x in range(a, b+1):
        L7.set(x, L7.top[x], '>' if (a // 7) % 2 == 0 else '<')
L7.spikes(46, 47, 9)
L7.spikes(50, 51, 9)
L7.spikes(86, 87)
L7.spikes(90, 91)
L7.ent(3, '@')
L7.air(18, 2, 'p'); L7.air(38, 2, 'p'); L7.air(52, 2, 'P'); L7.air(74, 2, 'p')
L7.air(90, 2, 'p'); L7.air(112, 2, 'P'); L7.air(140, 2, 'p')
L7.ent(34, 'd'); L7.ent(64, 'd'); L7.ent(84, 'D'); L7.ent(108, 'd'); L7.ent(128, 'D')
L7.air(28, 8, 't'); L7.air(101, 8, 't')
L7.air(45, 6, '+'); L7.air(123, 9, '+')
L7.ent(76, '$')
L7.ent(147, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 8
# Віртуальний простір + арена ГЛІТЧ-ЯДРА.
L8 = Lv('ВІРТУАЛЬНИЙ ПРОСТІР', 'virtual', 120, boss='glitch')
L8.pit(13, 15)
L8.ground(16, 28, 11)
L8.pit(30, 32)
L8.ground(33, 46, 13)
L8.ground(47, 49, 12)
L8.ground(50, 58, 10)
L8.pit(60, 62)
L8.ground(63, 76, 12)
L8.pit(78, 80)
L8.ground(81, 89, 11)
L8.ground(90, 120, 13)
L8.plat(18, 8, 4); L8.plat(36, 10, 4); L8.plat(42, 8, 4); L8.plat(50, 7, 4)
L8.plat(66, 9, 5); L8.plat(84, 8, 4)
L8.plat(95, 11, 5); L8.plat(105, 11, 5)
L8.ceil(90, 120, 1)
L8.ent(3, '@')
L8.ent(9, 'f'); L8.ent(26, 'f'); L8.ent(54, 'F'); L8.ent(72, 'f'); L8.ent(86, 'F')
L8.ent(20, 's'); L8.ent(40, 's'); L8.ent(44, 'S'); L8.ent(68, 's'); L8.ent(74, 'S')
L8.air(19, 7, '+'); L8.air(85, 7, '+')
L8.ent(64, '$')
L8.ent(90, '!')
L8.ent(117, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 9
# Шпиль корпорації: вітер, ліфти, всі типи ворогів і елітні версії.
L9 = Lv('ШПИЛЬ КАЙЗЕН-ВОЛЬТ', 'spire', 150)
L9.ground(0, 12, 13)
L9.pit(13, 15)
L9.ground(16, 28, 12)
L9.pit(29, 31)
L9.ground(32, 44, 11)
L9.pit(46, 48)
L9.ground(49, 60, 13)
L9.ground(61, 72, 11)
L9.pit(74, 76)
L9.ground(77, 91, 12)
L9.pit(92, 94)
L9.ground(95, 97, 11)
L9.ground(98, 108, 10)
L9.pit(110, 112)
L9.ground(113, 128, 12)
L9.pit(130, 132)
L9.ground(133, 150, 13)
L9.plat(18, 9, 4); L9.plat(34, 8, 4); L9.plat(52, 10, 4); L9.plat(64, 8, 4)
L9.plat(80, 9, 4); L9.plat(98, 7, 4); L9.plat(116, 9, 4); L9.plat(136, 10, 4)
L9.mplat(29, 13, 3, 'h', 3, 38)
L9.mplat(74, 10, 3, 'v', 3, 34)
L9.mplat(110, 12, 3, 'h', 3, 40)
L9.ent(3, '@')
L9.ent(10, 'H'); L9.ent(40, 'H'); L9.ent(86, 'H'); L9.ent(126, 'H')
L9.ent(24, 'A'); L9.ent(56, 'a'); L9.ent(104, 'A'); L9.ent(140, 'A')
L9.ent(68, 'D'); L9.ent(120, 'd')
L9.air(36, 6, 'W'); L9.air(84, 5, 'w'); L9.air(118, 5, 'W')
L9.air(50, 6, 'K'); L9.air(100, 5, 'k'); L9.air(138, 5, 'K')
L9.air(20, 7, 't'); L9.air(66, 6, 'T'); L9.air(114, 7, 'T')
L9.ent(62, 'F'); L9.ent(122, 'f')
L9.ent(58, 's'); L9.ent(96, 'S')
L9.air(99, 5, '+'); L9.air(137, 8, '+'); L9.air(19, 7, '+')
L9.ent(77, '$')
L9.ent(147, 'E')

# ---------------------------------------------------------------- РІВЕНЬ 10
# Ядро «Архітектора»: короткий підхід і велика фінальна арена.
L10 = Lv('ЯДРО АРХІТЕКТОРА', 'core', 90, boss='architect')
L10.ground(0, 14, 13)
L10.pit(16, 18)
L10.ground(19, 32, 12)
L10.pit(34, 36)
L10.ground(37, 48, 11)
L10.ground(49, 59, 13)
L10.ground(60, 90, 13)
L10.ceil(0, 90, 1)
L10.plat(21, 9, 5); L10.plat(40, 8, 5); L10.plat(52, 10, 4)
L10.plat(66, 11, 5); L10.plat(78, 11, 5)
L10.ent(3, '@')
L10.ent(10, 'D'); L10.ent(28, 'A'); L10.ent(44, 'D'); L10.ent(56, 'A')
L10.air(24, 7, 'T'); L10.air(41, 6, '+')
L10.air(30, 6, 'K'); L10.air(50, 6, 'W')
L10.ent(53, '$')
L10.air(58, 11, '+')
L10.ent(60, '!')
L10.ent(87, 'E')

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
