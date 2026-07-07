const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("D:/prawajazdy/database.db");

db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS Question (
  id INTEGER PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Bez kategorii',
  mediaPath TEXT,
  mediaType TEXT,
  correctAnswer TEXT NOT NULL,
  options TEXT,
  weight INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'SPECIALIST',
  explanation TEXT
);
CREATE INDEX IF NOT EXISTS Question_category_idx ON Question(category);
CREATE INDEX IF NOT EXISTS Question_weight_idx ON Question(weight);
CREATE INDEX IF NOT EXISTS Question_kind_idx ON Question(kind);
CREATE TABLE IF NOT EXISTS Attempt (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  mode TEXT NOT NULL,
  startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finishedAt DATETIME,
  score INTEGER NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS AttemptAnswer (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  attemptId INTEGER NOT NULL,
  questionId INTEGER NOT NULL,
  isCorrect BOOLEAN NOT NULL,
  timeSpentSeconds INTEGER NOT NULL DEFAULT 0,
  selectedAnswer TEXT,
  CONSTRAINT AttemptAnswer_attemptId_fkey FOREIGN KEY (attemptId) REFERENCES Attempt(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT AttemptAnswer_questionId_fkey FOREIGN KEY (questionId) REFERENCES Question(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS AttemptAnswer_attemptId_idx ON AttemptAnswer(attemptId);
CREATE INDEX IF NOT EXISTS AttemptAnswer_questionId_idx ON AttemptAnswer(questionId);
CREATE TABLE IF NOT EXISTS DifficultQuestion (
  questionId INTEGER PRIMARY KEY NOT NULL,
  addedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  timesReviewed INTEGER NOT NULL DEFAULT 0,
  lastReviewedAt DATETIME,
  mastered BOOLEAN NOT NULL DEFAULT false,
  correctStreak INTEGER NOT NULL DEFAULT 0,
  nextReviewAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT DifficultQuestion_questionId_fkey FOREIGN KEY (questionId) REFERENCES Question(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS StatsByCategory (
  category TEXT PRIMARY KEY NOT NULL,
  totalAnswered INTEGER NOT NULL DEFAULT 0,
  totalCorrect INTEGER NOT NULL DEFAULT 0
);
`);

db.close();
console.log("database created");
