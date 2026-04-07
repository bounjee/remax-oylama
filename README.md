# RE/MAX Best Şıklık Oylaması

## Kurulum
```bash
npm install
npm start
```

## Adresler
- Kullanıcı ekranı: `http://localhost:3000`
- Admin paneli: `http://localhost:3000/admin`

## Admin giriş
- Kullanıcı adı: `admin`
- Şifre: `Remax35!!`

## Netlify
- `netlify.toml` hazır (build: `npm install`, yayın: `public/`, functions: `netlify/functions`).
- Üretimde **Site settings → Environment variables**: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, güçlü bir `SESSION_SECRET`.

### GitHub ile yayın (önerilen)
1. [GitHub](https://github.com)’da **New repository** ile boş bir repo oluştur (README ekleme zorunlu değil).
2. Bilgisayarında proje klasöründe (bir kez):

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/KULLANICI/REPO.git
   git push -u origin main
   ```

   (`KULLANICI/REPO` kendi repo adresinle değiştir.)

3. [Netlify](https://app.netlify.com) → **Add new site** → **Import an existing project** → GitHub’ı bağla → repoyu seç.
4. Build ayarları genelde otomatik gelir; `netlify.toml` **Build command** ve **Publish directory**’yi belirler. **Deploy site** de.
5. Deploy bitince **Site settings → Environment variables** ile `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` ekle; gerekirse **Deploys → Trigger deploy** ile yeniden derle.

Sonraki her `git push` otomatik yeniden deploy eder.

### Netlify CLI
Proje klasöründe sırayla (ilk kez tarayıcıdan giriş ister):

```bash
npm install
npm run netlify:login
npm run netlify:link
```

`link` sihirbazında yeni site oluştur veya mevcut siteyi seç; sonra:

```bash
npm run netlify:deploy:prod
```

Taslak URL denemek için:

```bash
npm run netlify:deploy
```

Veri **Netlify Blobs** ile saklanır.

## Yerel Netlify benzeri ortam
```bash
npm run dev:netlify
```
