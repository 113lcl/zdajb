# Plan rozwoju strony do przygotowania do egzaminu na prawo jazdy (PL)

## 1. Opis projektu

Prywatna strona do treningu przed teoretycznym egzaminem na prawo jazdy w Polsce. Projekt obejmuje dwa tryby rozwiązywania pytań, system trudnych pytań z inteligentnymi powtórkami, statystyki, timer egzaminacyjny oraz obsługę offline jako PWA.

## 2. Stos technologiczny

Wybrany stos jest łatwy do modyfikacji, a jednocześnie pozwala zbudować estetyczny i wygodny interfejs:

- **Frontend:** React + Vite + TypeScript, Tailwind CSS do szybkiego tworzenia systemu wizualnego, Framer Motion do płynnych animacji przejść między pytaniami.
- **Baza danych:** SQLite jako plik `database.db`, łatwy do przeglądania i edycji np. przez DB Browser for SQLite, bez potrzeby instalacji osobnego serwera bazy danych.
- **ORM:** Prisma, która upraszcza pracę z SQLite, migracje i czytelną definicję schematu.
- **PWA:** vite-plugin-pwa do cache offline i instalacji strony na telefonie lub komputerze.
- **Import danych:** jednorazowy skrypt Node.js czytający plik xlsx przez bibliotekę `xlsx` lub `exceljs` i zapisujący pytania oraz ścieżki do mediów w SQLite przy pierwszym uruchomieniu.

## 3. Struktura danych

### Tabela `questions`

| Pole | Typ | Opis |
| --- | --- | --- |
| id | int | ID pytania z xlsx |
| text | string | Treść pytania |
| category | string | Kategoria, np. znaki, pierwszeństwo, jeśli występuje w xlsx |
| media_path | string | Ścieżka do pliku multimedialnego, zdjęcia lub wideo |
| correct_answer | string/bool | Poprawna odpowiedź |
| options | json | Warianty odpowiedzi, jeśli pytanie je posiada |
| weight | int | Waga pytania: 1, 2 lub 3 punkty zgodnie z zasadami egzaminu PL |

### Tabela `attempts`

Podejścia i sesje użytkownika.

### Tabela `attempt_answers`

Odpowiedzi udzielone w ramach podejścia.

### Tabela `difficult_questions`

Lista pytań oznaczonych jako trudne oraz dane powtórek.

### Tabela `stats_by_category`

`category`, `total_answered`, `total_correct` - aktualizowane po każdej próbie na potrzeby panelu statystyk.

## 4. Logika dwóch trybów

**Niekończący się trening**

- Pytania pojawiają się losowo albo w pętli, bez limitu czasu i bez końcowego wyniku punktowego.
- Po odpowiedzi od razu wyświetla się informacja, czy odpowiedź była poprawna, oraz krótkie wyjaśnienie, jeśli jest dostępne.
- Przycisk dodania do trudnych pytań jest dostępny przy każdym pytaniu.

**Standardowy egzamin, 74 punkty, zasady PL**

- Stały zestaw pytań z uwzględnieniem wag 1, 2 i 3 punkty, z maksymalnym wynikiem 74 punktów.
- Timer dla każdego pytania zgodny z realnym trybem egzaminacyjnym.
- Odpowiedzi nie są pokazywane do końca egzaminu.
- Na końcu: wynik z 74 punktów, status zdany/niezdany, przegląd błędów i możliwość dodania błędnych pytań do trudnych.

## 5. Trudne pytania i inteligentne powtórki

- Przycisk oznaczenia pytania jako trudne w każdym trybie.
- Osobny dział menu „Trudne pytania” z listą, licznikiem powtórek i datą ostatniego powtórzenia.
- Tryb treningu tylko dla trudnych pytań.
- Prosty algorytm spaced repetition: pytanie z dwiema poprawnymi odpowiedziami z rzędu otrzymuje status `mastered` i pojawia się rzadziej; po błędnej odpowiedzi odstęp powtórki się skraca.

## 6. Statystyki

- Panel: procent poprawnych odpowiedzi według kategorii, historia podejść egzaminacyjnych jako wykres wyników w czasie, liczba trudnych pytań, postęp opanowania pytań `mastered` vs aktywne.
- Prosty wykres Recharts, spójny z systemem wizualnym.

## 7. PWA / offline

- Manifest i service worker cacheują pytania oraz media po pierwszym uruchomieniu.
- Możliwość instalacji strony na telefonie lub komputerze.

## 8. System wizualny

- Tło: ciemna szarość (#1E1E22 / #26262B), karty nieco jaśniejsze (#2E2E34), efekt głębi przez miękki cień zamiast ostrej ramki.
- Akcenty: niebieski #4FA8E8 dla elementów aktywnych, zielony #4CAF7D dla poprawnych odpowiedzi i sukcesu, czerwony #E55A5A dla błędów.
- Zaokrąglenia: minimum 16px na kartach, 12px na przyciskach, bez ostrych rogów.
- Cienie: miękkie i rozmyte, o niskiej przezroczystości.
- Animacje: fade i lekki slide przy zmianie pytania (200-300 ms), płynny progress bar, delikatne scale przy naciśnięciu przycisku.
- Typografia: czytelny, łagodny font, np. Inter albo Manrope, duży tekst pytania i wygodne odstępy.

## 9. Etapy rozwoju

1. Inicjalizacja projektu: Vite + React + TS + Tailwind, konfiguracja Prisma + SQLite.
2. Skrypt importu xlsx do bazy danych i sprawdzenie zgodności plików mediów.
3. System wizualny: kolory, komponenty Button, Card, ProgressBar w konfiguracji Tailwind.
4. Ekran niekończącego się treningu.
5. Ekran egzaminu: logika wag, punktów i timera.
6. Sekcja trudnych pytań oraz logika spaced repetition.
7. Panel statystyk.
8. Konfiguracja PWA i końcowe dopracowanie animacji.
9. Testy na realnych danych z xlsx.

---

# Prompt dla VS Code Copilot

Skopiuj cały tekst poniżej do Copilot Chat w trybie Agent/Edit jako początkowe polecenie:

```text
Chcę stworzyć prywatną stronę internetową do przygotowania do teoretycznego egzaminu na prawo jazdy w Polsce. Mam plik xlsx z pytaniami (treść pytania, poprawna odpowiedź, warianty odpowiedzi, kategoria, nazwa odpowiedniego pliku multimedialnego) oraz foldery z plikami multimedialnymi (zdjęcia/wideo), których nazwy odpowiadają wartościom z xlsx.

STOS:
- Frontend: React + Vite + TypeScript + Tailwind CSS + Framer Motion do płynnych animacji.
- Backend/API: Node.js + Express albo API routes, jeśli projekt zostanie zbudowany inaczej.
- Baza danych: SQLite przez Prisma ORM.
- PWA przez vite-plugin-pwa.
- Import xlsx przez bibliotekę "xlsx" w jednorazowym skrypcie Node.

STRUKTURA DANYCH:
Zaprojektuj schemat Prisma dla pytań, podejść, odpowiedzi, trudnych pytań i statystyk według kategorii.

FUNKCJONALNOŚĆ:
1. Skrypt importu czyta xlsx, dla każdego wiersza znajduje plik w folderze mediów po nazwie, kopiuje lub linkuje go do /public/media i tworzy rekord Question w bazie. W konsoli pokaż listę pytań, dla których nie znaleziono pliku multimedialnego.
2. Tryb "Niekończący się trening": losowe pytania bez limitu czasu, natychmiastowe pokazanie poprawności odpowiedzi, przycisk dodania do trudnych pytań przy każdym pytaniu.
3. Tryb "Egzamin" według zasad polskich: zestaw pytań na 74 punkty, pytania o wadze 1, 2 i 3 punkty, aktualne reguły rozkładu pytań i próg zdania, indywidualny timer, ukryte odpowiedzi do końca, końcowy wynik, status zdany/niezdany oraz przegląd błędów z możliwością dodania ich do trudnych.
4. Sekcja "Trudne pytania": lista oznaczonych pytań, licznik powtórek, prosty algorytm spaced repetition (2 poprawne odpowiedzi z rzędu -> mastered i rzadsze pokazywanie; błąd -> krótszy interwał), osobny trening tylko z tej listy.
5. Panel statystyk: procent poprawnych odpowiedzi według kategorii, historia egzaminów z wykresem wyników w czasie (użyj Recharts), liczba trudnych pytań mastered/aktywnych.
6. PWA: cache pytań i mediów do pracy offline, możliwość instalacji na urządzeniu.

DESIGN:
- Ciemnoszara paleta (tło ok. #1E1E22, karty ok. #2E2E34), bez ostrych przejść, tylko miękkie cienie dla głębi.
- Akcenty: niebieski #4FA8E8, zielony #4CAF7D, czerwony #E55A5A.
- Zaokrąglenia minimum 16px na kartach i 12px na przyciskach.
- Płynne przejścia między pytaniami przez Framer Motion, animowany progress bar, miękka reakcja przycisków na kliknięcie.
- Font o miękkich, czytelnych formach (Inter lub Manrope), duży tekst pytania, wygodne odstępy.

Zacznij od: 1) inicjalizacji projektu i konfiguracji motywu Tailwind z podanymi kolorami i zaokrągleniami, 2) schematu Prisma i skryptu importu xlsx, 3) podstawowego layoutu z nawigacją między trybami. Potem będziemy etapami tworzyć każdy ekran.
```

## Jak używać

1. Utwórz nowy pusty projekt lub folder i otwórz go w VS Code.
2. Otwórz Copilot Chat w trybie **Agent**.
3. Wklej cały prompt powyżej.
4. Podaj ścieżkę do pliku xlsx i folderów z mediami, gdy Copilot zapyta o import.
5. Pracuj etapami według punktu 9, sprawdzając każdy etap osobno.
