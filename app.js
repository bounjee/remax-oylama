const express = require("express");
const path = require("path");
const cookieSession = require("cookie-session");
const { query, mutate } = require("./lib/store");

function normalizeName(text = "") {
  return String(text).trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

function createApp() {
  const app = express();

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Remax35!!";

  const SESSION_SECRET = process.env.SESSION_SECRET || "remax-best-secret-key-change-in-prod-is-better";

  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    cookieSession({
      name: "remax_sess",
      keys: [SESSION_SECRET],
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true
    })
  );

  function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    return res.status(401).json({ message: "Yetkisiz erişim." });
  }

  function ah(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  }

  const onNetlify = process.env.NETLIFY === "true";

  if (!onNetlify) {
    app.use(express.static(path.join(__dirname, "public")));
    app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
    app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
  }

  app.get(
    "/api/public/status",
    ah(async (req, res) => {
      const votingOpen = await query(s => !!s.settings.voting_open);
      res.json({ votingOpen });
    })
  );

  app.get(
    "/api/public/candidates",
    ah(async (req, res) => {
      const fullName = normalizeName(req.query.fullName || "");

      const payload = await query(state => {
        if (!state.settings.voting_open) {
          return { votingOpen: false, found: false, maleCandidates: [], femaleCandidates: [] };
        }

        if (!fullName) {
          return { votingOpen: true, found: false, maleCandidates: [], femaleCandidates: [] };
        }

        const voter = state.consultants.find(c => c.is_active === 1 && c.full_name === fullName);

        if (!voter) {
          return { votingOpen: true, found: false, maleCandidates: [], femaleCandidates: [] };
        }

        const maleCandidates = state.consultants
          .filter(c => c.is_active === 1 && c.gender === "ERKEK" && c.id !== voter.id)
          .map(c => ({ id: c.id, full_name: c.full_name }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));

        const femaleCandidates = state.consultants
          .filter(c => c.is_active === 1 && c.gender === "KADIN" && c.id !== voter.id)
          .map(c => ({ id: c.id, full_name: c.full_name }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));

        return { votingOpen: true, found: true, maleCandidates, femaleCandidates };
      });

      res.json(payload);
    })
  );

  app.post(
    "/api/public/vote",
    ah(async (req, res) => {
      const fullName = normalizeName(req.body.fullName || "");
      const maleId = Number(req.body.maleId);
      const femaleId = Number(req.body.femaleId);

      const result = await mutate(state => {
        if (!state.settings.voting_open) {
          return { ok: false, status: 400, message: "Oylama şu anda kapalı." };
        }

        if (!fullName || !maleId || !femaleId) {
          return { ok: false, status: 400, message: "Lütfen tüm alanları doldurunuz." };
        }

        const voter = state.consultants.find(c => c.is_active === 1 && c.full_name === fullName);

        if (!voter) {
          return { ok: false, status: 400, message: "Bu ad soyad danışman listesinde bulunamadı." };
        }

        const alreadyVoted = state.votes.find(v => v.voter_id === voter.id);
        if (alreadyVoted) {
          return { ok: false, status: 400, message: "Bu danışman adına daha önce oy kullanılmış." };
        }

        if (voter.id === maleId || voter.id === femaleId) {
          return { ok: false, status: 400, message: "Kendi adınıza oy veremezsiniz." };
        }

        const maleCandidate = state.consultants.find(
          c => c.id === maleId && c.is_active === 1 && c.gender === "ERKEK"
        );
        const femaleCandidate = state.consultants.find(
          c => c.id === femaleId && c.is_active === 1 && c.gender === "KADIN"
        );

        if (!maleCandidate || !femaleCandidate) {
          return { ok: false, status: 400, message: "Geçersiz aday seçimi." };
        }

        state.votes.push({
          id: state.nextIds.vote++,
          voter_id: voter.id,
          male_id: maleId,
          female_id: femaleId,
          created_at: new Date().toISOString()
        });

        return { ok: true, status: 200, message: "Oyunuz başarıyla kaydedildi." };
      });

      if (!result.ok) {
        return res.status(result.status).json({ message: result.message });
      }

      res.json({ message: result.message });
    })
  );

  app.post(
    "/api/admin/login",
    ah(async (req, res) => {
      const username = String(req.body.username || "");
      const password = String(req.body.password || "");

      if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Kullanıcı adı veya şifre hatalı." });
      }

      req.session.isAdmin = true;
      res.json({ message: "Giriş başarılı." });
    })
  );

  app.post(
    "/api/admin/logout",
    requireAdmin,
    ah(async (req, res) => {
      req.session = null;
      res.json({ message: "Çıkış yapıldı." });
    })
  );

  app.get(
    "/api/admin/session",
    ah(async (req, res) => {
      res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
    })
  );

  app.get(
    "/api/admin/dashboard",
    requireAdmin,
    ah(async (req, res) => {
      const data = await query(state => {
        const totalConsultants = state.consultants.filter(c => c.is_active === 1).length;
        const votedCount = state.votes.length;
        const notVotedCount = totalConsultants - votedCount;
        const votingOpen = !!state.settings.voting_open;
        return { totalConsultants, votedCount, notVotedCount, votingOpen };
      });
      res.json(data);
    })
  );

  app.get(
    "/api/admin/consultants",
    requireAdmin,
    ah(async (req, res) => {
      const rows = await query(state => {
        const votedSet = new Set(state.votes.map(v => v.voter_id));
        return state.consultants
          .map(c => ({
            id: c.id,
            full_name: c.full_name,
            gender: c.gender,
            is_active: c.is_active,
            has_voted: votedSet.has(c.id) ? 1 : 0
          }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
      });
      res.json(rows);
    })
  );

  app.post(
    "/api/admin/consultants",
    requireAdmin,
    ah(async (req, res) => {
      const fullName = normalizeName(req.body.fullName || "");
      const gender = String(req.body.gender || "").toUpperCase();

      if (!fullName || !["ERKEK", "KADIN"].includes(gender)) {
        return res.status(400).json({ message: "Geçerli ad soyad ve cinsiyet giriniz." });
      }

      const result = await mutate(state => {
        const exists = state.consultants.some(c => c.full_name === fullName);
        if (exists) {
          return { ok: false, message: "Bu danışman zaten mevcut." };
        }

        state.consultants.push({
          id: state.nextIds.consultant++,
          full_name: fullName,
          gender,
          is_active: 1,
          created_at: new Date().toISOString()
        });

        return { ok: true, message: "Danışman eklendi." };
      });

      if (!result.ok) {
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: result.message });
    })
  );

  app.post(
    "/api/admin/consultants/bulk",
    requireAdmin,
    ah(async (req, res) => {
      const rawText = String(req.body.rawText || "");
      const lines = rawText.split("\n").map(x => x.trim()).filter(Boolean);
      if (!lines.length) {
        return res.status(400).json({ message: "Toplu ekleme alanı boş olamaz." });
      }

      const message = await mutate(state => {
        let added = 0;

        for (const line of lines) {
          const parts = line.split("|");
          const fullName = normalizeName(parts[0] || "");
          const gender = String(parts[1] || "").trim().toUpperCase();
          if (!fullName || !["ERKEK", "KADIN"].includes(gender)) continue;

          const exists = state.consultants.some(c => c.full_name === fullName);
          if (exists) continue;

          state.consultants.push({
            id: state.nextIds.consultant++,
            full_name: fullName,
            gender,
            is_active: 1,
            created_at: new Date().toISOString()
          });
          added += 1;
        }

        return `${added} danışman eklendi.`;
      });

      res.json({ message });
    })
  );

  app.put(
    "/api/admin/consultants/:id",
    requireAdmin,
    ah(async (req, res) => {
      const id = Number(req.params.id);
      const fullName = normalizeName(req.body.fullName || "");
      const gender = String(req.body.gender || "").toUpperCase();
      const isActive = Number(req.body.isActive) ? 1 : 0;

      if (!id || !fullName || !["ERKEK", "KADIN"].includes(gender)) {
        return res.status(400).json({ message: "Geçersiz veri." });
      }

      const result = await mutate(state => {
        const row = state.consultants.find(c => c.id === id);
        if (!row) {
          return { ok: false, message: "Güncelleme başarısız." };
        }

        const nameTaken = state.consultants.some(c => c.id !== id && c.full_name === fullName);
        if (nameTaken) {
          return { ok: false, message: "Bu danışman zaten mevcut." };
        }

        row.full_name = fullName;
        row.gender = gender;
        row.is_active = isActive;

        return { ok: true, message: "Danışman güncellendi." };
      });

      if (!result.ok) {
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: result.message });
    })
  );

  app.delete(
    "/api/admin/consultants/:id",
    requireAdmin,
    ah(async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: "Geçersiz id." });

      const result = await mutate(state => {
        const linkedVote = state.votes.find(
          v => v.voter_id === id || v.male_id === id || v.female_id === id
        );

        if (linkedVote) {
          const row = state.consultants.find(c => c.id === id);
          if (row) row.is_active = 0;
          return { ok: true, message: "Danışman pasife alındı. Oy kayıtları korundu." };
        }

        state.consultants = state.consultants.filter(c => c.id !== id);
        return { ok: true, message: "Danışman silindi." };
      });

      res.json({ message: result.message });
    })
  );

  app.get(
    "/api/admin/votes",
    requireAdmin,
    ah(async (req, res) => {
      const rows = await query(state => {
        const byId = new Map(state.consultants.map(c => [c.id, c]));
        return state.votes
          .slice()
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .map(v => ({
            id: v.id,
            created_at: v.created_at,
            voter_name: (byId.get(v.voter_id) || {}).full_name || "-",
            male_name: (byId.get(v.male_id) || {}).full_name || "-",
            female_name: (byId.get(v.female_id) || {}).full_name || "-"
          }));
      });
      res.json(rows);
    })
  );

  app.get(
    "/api/admin/results",
    requireAdmin,
    ah(async (req, res) => {
      const data = await query(state => {
        const maleCounts = new Map();
        const femaleCounts = new Map();

        for (const v of state.votes) {
          maleCounts.set(v.male_id, (maleCounts.get(v.male_id) || 0) + 1);
          femaleCounts.set(v.female_id, (femaleCounts.get(v.female_id) || 0) + 1);
        }

        const maleResults = state.consultants
          .filter(c => c.gender === "ERKEK")
          .map(c => ({ full_name: c.full_name, vote_count: maleCounts.get(c.id) || 0 }))
          .sort(
            (a, b) =>
              b.vote_count - a.vote_count || a.full_name.localeCompare(b.full_name, "tr")
          );

        const femaleResults = state.consultants
          .filter(c => c.gender === "KADIN")
          .map(c => ({ full_name: c.full_name, vote_count: femaleCounts.get(c.id) || 0 }))
          .sort(
            (a, b) =>
              b.vote_count - a.vote_count || a.full_name.localeCompare(b.full_name, "tr")
          );

        return { maleResults, femaleResults };
      });

      res.json(data);
    })
  );

  app.put(
    "/api/admin/voting",
    requireAdmin,
    ah(async (req, res) => {
      const votingOpen = Number(req.body.votingOpen) ? 1 : 0;

      const message = await mutate(state => {
        state.settings.voting_open = votingOpen;
        return `Oylama ${votingOpen ? "açıldı" : "kapatıldı"}.`;
      });

      res.json({ message });
    })
  );

  app.post(
    "/api/admin/reset",
    requireAdmin,
    ah(async (req, res) => {
      await mutate(state => {
        state.votes = [];
        return null;
      });
      res.json({ message: "Tüm oylar sıfırlandı." });
    })
  );

  app.use((err, req, res, next) => {
    void next;
    console.error("API error:", err && err.message, err && err.stack);
    res.status(500).json({ message: "Sunucu hatası." });
  });

  return app;
}

module.exports = { createApp };
