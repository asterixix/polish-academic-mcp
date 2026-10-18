-- Domyślne kategorie źródeł i limit wyników na źródło dla AI Search (puste = automatyczny dobór)
ALTER TABLE user_preferences ADD COLUMN default_groups TEXT NOT NULL DEFAULT '';
ALTER TABLE user_preferences ADD COLUMN default_per_source INTEGER NOT NULL DEFAULT 8;
