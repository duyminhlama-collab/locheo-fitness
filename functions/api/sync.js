
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 80);
}

async function getRecord(db, code) {
  const row = await db
    .prepare(
      "SELECT code, data, version, updated_at FROM sync_data WHERE code = ?"
    )
    .bind(code)
    .first();

  if (!row) return null;

  return {
    code: row.code,
    data: JSON.parse(row.data),
    version: row.version,
    updated_at: row.updated_at
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ error: "Database binding DB chưa được cấu hình." }, 500);
  }

  const db = env.DB;

  if (request.method === "GET") {
    const url = new URL(request.url);
    const code = cleanCode(url.searchParams.get("code"));

    if (!code) {
      return json({ error: "Thiếu mã nhóm." }, 400);
    }

    const row = await getRecord(db, code);

    if (!row) {
      return json({ version: 0, data: null });
    }

    const since = url.searchParams.get("since");

    if (since !== null && Number(since) === row.version) {
      return json({ version: row.version, unchanged: true });
    }

    return json(row);
  }

  if (request.method === "PUT") {
    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Dữ liệu JSON không hợp lệ." }, 400);
    }

    const code = cleanCode(body.code);
    const data = body.data;
    const baseVersion = body.baseVersion;

    if (!code || !data || typeof data !== "object") {
      return json({ error: "Thiếu mã nhóm hoặc dữ liệu." }, 400);
    }

    if (
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0
    ) {
      return json({ error: "Phiên bản dữ liệu không hợp lệ." }, 400);
    }

    const serialized = JSON.stringify(data);

    if (serialized.length > 900000) {
      return json({ error: "Dữ liệu quá lớn." }, 413);
    }

    const current = await getRecord(db, code);

    if (!current) {
      if (baseVersion !== 0) {
        return json({ version: 0, data: null }, 409);
      }

      try {
        await db
          .prepare(
            "INSERT INTO sync_data (code, data, version) VALUES (?, ?, 1)"
          )
          .bind(code, serialized)
          .run();
      } catch {
        const latest = await getRecord(db, code);
        return json(latest || { version: 0, data: null }, 409);
      }

      const created = await getRecord(db, code);
      return json(created);
    }

    if (current.version !== baseVersion) {
      return json(current, 409);
    }

    const result = await db
      .prepare(
        `UPDATE sync_data
         SET data = ?, version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE code = ? AND version = ?`
      )
      .bind(serialized, code, baseVersion)
      .run();

    if (result.meta.changes === 0) {
      const latest = await getRecord(db, code);
      return json(latest || { version: 0, data: null }, 409);
    }

    const updated = await getRecord(db, code);
    return json(updated);
  }

  return json(
    { error: "Phương thức không được hỗ trợ." },
    405
  );
}
