use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct Transcription {
    pub id: i64,
    pub text: String,
    pub language: String,
    pub duration_ms: i64,
    pub model: String,
    pub created_at: String,
}

impl Database {
    pub fn new(path: PathBuf) -> anyhow::Result<Self> {
        let db = Self { path };
        db.init()?;
        Ok(db)
    }

    pub fn insert(
        &self,
        text: &str,
        language: &str,
        duration_ms: i64,
        model: &str,
    ) -> anyhow::Result<()> {
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO transcriptions (text, language, duration_ms, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                text,
                language,
                duration_ms,
                model,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        conn.execute(
            "DELETE FROM transcriptions
             WHERE id NOT IN (
               SELECT id FROM transcriptions ORDER BY id DESC LIMIT 100
             )",
            [],
        )?;
        Ok(())
    }

    pub fn list(&self, limit: i64) -> anyhow::Result<Vec<Transcription>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT id, text, language, duration_ms, model, created_at
             FROM transcriptions
             ORDER BY id DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(Transcription {
                id: row.get(0)?,
                text: row.get(1)?,
                language: row.get(2)?,
                duration_ms: row.get(3)?,
                model: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn delete(&self, id: i64) -> anyhow::Result<()> {
        self.open()?
            .execute("DELETE FROM transcriptions WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear(&self) -> anyhow::Result<()> {
        self.open()?.execute("DELETE FROM transcriptions", [])?;
        Ok(())
    }

    fn init(&self) -> anyhow::Result<()> {
        let conn = self.open()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS transcriptions (
                id INTEGER PRIMARY KEY,
                text TEXT NOT NULL,
                language TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transcriptions_created
                ON transcriptions(created_at DESC);",
        )?;
        Ok(())
    }

    fn open(&self) -> anyhow::Result<Connection> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Ok(Connection::open(&self.path)?)
    }
}
