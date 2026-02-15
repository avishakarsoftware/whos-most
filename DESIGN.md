# Who's Most Likely To — Game Design

A party game where players vote on who in the group best fits a prompt. Played on phones with a shared TV/screen display.

---

## Core Game Flow

1. **Organizer creates a game** — picks a category or lets AI generate questions (e.g. "Spicy", "Wholesome", "Work Edition")
2. **Players join** via a room code on their phones
3. **Each round**: a prompt is displayed on everyone's screen (e.g. "Who is most likely to have an affair?")
4. **Players vote** — the answer choices are the names/avatars of all players in the room. 60-second timer.
5. **Results reveal** — dramatic podium animation (3rd → 2nd → 1st) showing who got the most votes
6. **Organizer advances** to the next question
7. **End-of-game summary** — superlatives, stats, highlights

---

## Two-Screen Architecture

### 1. Shared Screen (TV / Laptop / Projector)
The "stage" that everyone looks at together. Shows:
- **Lobby** — room code, list of players as they join
- **Question reveal** — the prompt in big text, dramatic entrance animation
- **Timer** — large countdown visible to the room
- **Live vote count** — "7 of 8 have voted" (no spoilers on who)
- **Podium reveal** — the cinematic 3rd → 2nd → 1st animation with names/avatars
- **Vote breakdown** — who voted for whom (optional, organizer toggle)
- **End-of-game superlatives**

TV screen design principles:
- Big text, high contrast — readable from across a room
- Minimal UI — no clutter, just the current state
- Animations — the podium reveal is the star moment, invest in making it feel like a game show
- Sound effects — countdown ticks, drumroll before reveal, celebration sounds

### 2. Player Phone
Personal, private screen. Shows:
- **Join screen** — enter room code, pick name/avatar
- **Waiting screen** — "waiting for next question..."
- **Voting screen** — grid/list of all player names, tap to vote, confirm
- **Vote submitted** — "waiting for others..." with timer
- **Results mirror** — see the same podium/results (so people in the back of the room can still see)

---

## Organizer Flow

### 1. Create Game
- **Pick a category/vibe** — "Party Night", "Spicy", "Wholesome", "Work Friends", "Custom"
- **AI generates questions** — instantly produces 15-20 prompts based on the vibe
- **Review & edit list** — organizer can:
  - Remove questions they don't like
  - Edit wording
  - Add their own custom questions
  - Regenerate individual questions
  - Reorder questions
- **Set game options** — number of questions, timer duration, anonymous vs. exposed votes, etc.

### 2. Create Room
- Game is ready → generates a **room code**
- TV screen shows the **lobby** — room code front and center
- Organizer shares the code verbally / shows the TV

### 3. Lobby
- Organizer sees players joining in real-time (on their phone + TV)
- Can **kick** players if needed
- When everyone's in → hits **Start Game**

### 4. During Game (Remote Control)
- **Next Question** — advances after everyone's seen the results
- **Skip** — skip a question mid-round
- **Pause** — freeze the game if needed
- **End Early** — wrap up and go to superlatives

### 5. Post-Game
- **Play Again** — same group, new questions (or reshuffled)
- **New Game** — back to question setup
- **Share Results** — generate a summary card

### Organizer as Player
The organizer is also a player — they vote too. Their phone has an extra control bar (Skip / Next / End) layered on top of the same voting experience.

```
┌─────────────────────────┐
│  [Skip]  [Next]  [End]  │  ← organizer controls
├─────────────────────────┤
│                         │
│   Who is most likely    │
│   to ghost someone?     │
│                         │
│   👤 Alex               │
│   👤 Jordan             │
│   👤 Sam                │
│   👤 Riley              │
│                         │
└─────────────────────────┘
```

---

## Full Journey

```
Organizer                    TV                    Players
────────                     ──                    ───────
Pick vibe / category
AI generates questions
Review / edit / finalize
Create room            →     Shows lobby + code
                                                   Join via code
See players joining     ←    Players appear    ←   Enter name
Hit Start              →     Question reveal   →   See question
Vote on phone                Timer counting         Vote on phone
                             "6/8 voted"
                             Podium reveal     →   See results
Hit Next               →     Next question     →   Next vote
...                          ...                    ...
                             Superlatives      →   See summary
Play Again / New Game
```

---

## Design Decisions

### Question Generation
- AI-generated packs — organizer picks a vibe/category and AI generates 10-20 prompts
- Pre-made packs — curated sets (Party Night, Office Edition, Family Friendly, Spicy, etc.)
- Custom questions — organizer can write their own or edit AI suggestions
- Mix — start from a pack, swap out questions, add custom ones

### Voting Mechanics
- **Single vote** — pick one person per question (simplest, clearest results)
- **Can you vote for yourself?** — allowing it is funnier
- **Anonymous vs. visible votes** — reveal who voted for whom after results creates the best drama/laughs (organizer toggle)

### Results Presentation
- **Podium reveal** (3rd → 2nd → 1st) with vote counts — dramatic, TV-show feel
- **Vote breakdown** — after the podium, show who voted for whom (the juicy part)
- **Ties** — share the podium spot

### Scoring / Progression
- **Option A: No scoring** — pure social fun, no winner. Each round is standalone entertainment.
- **Option B: Points system** — players earn points for getting votes (most voted = most points). Leaderboard at the end.
- **Option C: Prediction scoring** — bonus points if you voted with the majority (rewards "reading the room")

### End-of-Game
- **Superlatives page** — "Most Voted Overall", "Most Self-Votes", "Most Controversial" (tightest vote splits)
- **Shareable results** — screenshot-friendly summary card

---

## What Makes It Fun

- **Zero skill barrier** — anyone can play, no trivia knowledge needed
- **Social tension** — the laughs come from the group dynamics, not the game mechanics
- **The reveal** — who voted for whom is where the real entertainment lives
- **Replayability** — different groups produce completely different results with the same questions

---

## Open Questions

1. **Player count** — min 3, sweet spot 8-12, max TBD
2. **Timer** — fixed 60s, or organizer-controlled ("everyone done? next!")?
3. **Rounds per game** — fixed (e.g. 10 questions) or organizer picks?
4. **Game persistence** — should organizers save question packs for reuse? (likely v2)
5. **Accounts** — needed for organizers? Or fully anonymous, no-signup experience?
