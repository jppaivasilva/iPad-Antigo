#!/usr/bin/env python3
"""Gera dados.txt (cifrado) com previsão do tempo, notícias, cotação do dólar
e próximos compromissos da agenda da Apple (iCloud).

Roda no GitHub Actions (ou localmente). Usa só a biblioteca padrão.
O iPad só precisa ler esse JSON, que fica no mesmo site do painel:
assim evitamos problemas de CORS e de certificados no Safari antigo.
"""
import base64
import hashlib
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timedelta, timezone
from email.utils import parsedate_to_datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
PASTA_IMG = "img"          # miniaturas ficam em img/ junto da página
TAM_MINI = (224, 150)      # o dobro do tamanho na tela (112 x 75)
PASTA_RETRATOS = "retratos"  # fotos reduzidas e cifradas publicadas para o iPad
TAM_FOTO = (1024, 1024)    # cabe na tela do iPad 2 (1024 x 768) em qualquer posição
# Senha do painel: o site só mostra uma tela de login; dados e fotos vão
# cifrados (AES-CCM) e só abrem no iPad com a senha. Os mesmos valores
# estão em app.js.
SAL = b"ipad-antigo-painel"
ITERACOES = 20000
MEDIA = "{http://search.yahoo.com/mrss/}"
UA = "Mozilla/5.0 (painel-ipad; +https://github.com)"


def baixar(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def tempo(cfg):
    q = urllib.parse.urlencode({
        "latitude": cfg["latitude"],
        "longitude": cfg["longitude"],
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
        "hourly": "temperature_2m,weather_code,precipitation_probability",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
        "timezone": "auto",
        "forecast_days": 6,
    })
    return json.loads(baixar("https://api.open-meteo.com/v1/forecast?" + q))


def dolar():
    """Cotação USD/BRL. Tenta a AwesomeAPI (comercial, quase ao vivo);
    se falhar, usa a PTAX do Banco Central (uma vez por dia)."""
    try:
        d = json.loads(baixar("https://economia.awesomeapi.com.br/json/last/USD-BRL"))["USDBRL"]
        quando = datetime.fromtimestamp(int(d["timestamp"]), timezone.utc).isoformat()
        return {"valor": round(float(d["bid"]), 4), "variacao": round(float(d["pctChange"]), 2),
                "quando": quando, "fonte": "comercial"}
    except Exception as e:
        print("Falha na AwesomeAPI:", e, file=sys.stderr)
    serie = json.loads(baixar("https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/2?formato=json"))
    ultimo = float(serie[-1]["valor"])
    variacao = None
    if len(serie) > 1:
        variacao = round((ultimo / float(serie[-2]["valor"]) - 1) * 100, 2)
    dia, mes, ano = serie[-1]["data"].split("/")
    return {"valor": round(ultimo, 4), "variacao": variacao,
            "quando": "%s-%s-%sT13:00:00+00:00" % (ano, mes, dia), "fonte": "PTAX"}


def limpar(texto):
    texto = re.sub(r"<[^>]+>", " ", texto or "")
    return re.sub(r"\s+", " ", html.unescape(texto)).strip()


def imagem_do_item(item):
    """Acha a URL da imagem de um item RSS (media:*, enclosure ou <img> na descrição)."""
    candidatos = []
    for tag in ("content", "thumbnail"):
        for el in item.iter(MEDIA + tag):
            url = el.get("url")
            tipo = (el.get("type") or "") + (el.get("medium") or "")
            if url and (tag == "thumbnail" or "image" in tipo or re.search(r"\.(jpe?g|png|webp)", url, re.I)):
                candidatos.append(url)
    for el in item.iter("enclosure"):
        if el.get("url") and (el.get("type") or "").startswith("image"):
            candidatos.append(el.get("url"))
    for campo in ("description", "{http://purl.org/rss/1.0/modules/content/}encoded"):
        m = re.search(r"<img[^>]+src=[\"']([^\"']+)", item.findtext(campo) or "", re.I)
        if m:
            candidatos.append(html.unescape(m.group(1)))
    for url in candidatos:
        if url.startswith("//"):
            url = "https:" + url
        if url.startswith("http"):
            return url
    return None


def baixar_miniatura(url, pasta):
    """Baixa e reduz a imagem; devolve o caminho relativo (ex.: img/ab12.jpg) ou None."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None  # sem Pillow não mandamos a imagem grande para o iPad
    nome = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12] + ".jpg"
    destino = os.path.join(pasta, nome)
    if not os.path.exists(destino):
        try:
            img = Image.open(io.BytesIO(baixar(url, timeout=15)))
            img = ImageOps.fit(img.convert("RGB"), TAM_MINI, Image.LANCZOS)
            img.save(destino, "JPEG", quality=72, optimize=True, progressive=False)
        except Exception as e:
            print("Falha na imagem", url, e, file=sys.stderr)
            return None
    return PASTA_IMG + "/" + nome


def miniaturas(itens):
    pasta = os.path.join(RAIZ, PASTA_IMG)
    os.makedirs(pasta, exist_ok=True)
    usadas = set()
    for n in itens:
        url = n.pop("imagem_url", None)
        if url:
            caminho = baixar_miniatura(url, pasta)
            if caminho:
                n["imagem"] = caminho
                usadas.add(os.path.basename(caminho))
    for nome in os.listdir(pasta):  # apaga miniaturas de notícias antigas
        if nome.endswith(".jpg") and nome not in usadas:
            os.remove(os.path.join(pasta, nome))


def chave_da_senha(senha):
    return hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), SAL, ITERACOES, 16)


def cifrar(chave, conteudo):
    """AES-CCM com nonce de 12 bytes e etiqueta de 16 (igual ao sjcl no iPad).
    Sai em base64: nonce + texto cifrado + etiqueta."""
    from cryptography.hazmat.primitives.ciphers.aead import AESCCM
    nonce = os.urandom(12)
    return base64.b64encode(nonce + AESCCM(chave, tag_length=16).encrypt(nonce, conteudo, None)).decode("ascii")


DRIVE = "https://www.googleapis.com/drive/v3/files"


def drive_token(credenciais):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    c = service_account.Credentials.from_service_account_info(
        json.loads(credenciais), scopes=["https://www.googleapis.com/auth/drive.readonly"])
    c.refresh(Request())
    return c.token


def drive_get(url, token, timeout=60):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def drive_listar(pasta, token, maximo):
    itens, pagina = [], None
    while len(itens) < maximo:
        q = {
            "q": "'%s' in parents and mimeType contains 'image/' and trashed = false" % pasta,
            "fields": "nextPageToken, files(id, md5Checksum)",
            "orderBy": "createdTime desc",
            "pageSize": 1000,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if pagina:
            q["pageToken"] = pagina
        r = json.loads(drive_get(DRIVE + "?" + urllib.parse.urlencode(q), token))
        itens += r.get("files", [])
        pagina = r.get("nextPageToken")
        if not pagina:
            break
    return itens[:maximo]


def fotos(cfg, chave):
    """Baixa as fotos da pasta do Google Drive, reduz e cifra em retratos/.

    O nome do arquivo vem da chave + conteúdo da foto: não revela nada e
    muda se a foto ou a senha mudarem. Fotos já prontas (cache do Actions)
    não são baixadas de novo.
    """
    destino = os.path.join(RAIZ, PASTA_RETRATOS)
    os.makedirs(destino, exist_ok=True)
    credenciais = os.environ.get("GDRIVE_CREDENCIAIS")
    pasta = os.environ.get("GDRIVE_PASTA")
    if not (credenciais and pasta):
        print("Fotos: GDRIVE_CREDENCIAIS / GDRIVE_PASTA não configurados", file=sys.stderr)
        return None
    from PIL import Image, ImageOps
    try:  # fotos do iPhone (HEIC)
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass
    token = drive_token(credenciais)
    saida = []
    for arq in drive_listar(pasta, token, cfg.get("max_fotos", 300)):
        marca = (arq.get("md5Checksum") or arq["id"]).encode("ascii")
        final = hashlib.sha256(chave + marca).hexdigest()[:16] + ".txt"
        alvo = os.path.join(destino, final)
        if not os.path.exists(alvo):
            try:
                bruto = drive_get(DRIVE + "/" + arq["id"] + "?alt=media&supportsAllDrives=true", token, 120)
                img = ImageOps.exif_transpose(Image.open(io.BytesIO(bruto))).convert("RGB")
                img.thumbnail(TAM_FOTO, Image.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=80, optimize=True, progressive=False)
                with open(alvo, "w") as f:
                    f.write(cifrar(chave, buf.getvalue()))
            except Exception as e:
                print("Falha na foto", arq["id"], e, file=sys.stderr)
                continue
        saida.append(PASTA_RETRATOS + "/" + final)
    usadas = set(os.path.basename(c) for c in saida)
    for nome in os.listdir(destino):  # apaga fotos que saíram da pasta
        if nome not in usadas:
            os.remove(os.path.join(destino, nome))
    return saida


def agenda(cfg, url):
    """Próximos compromissos de uma agenda pública do iCloud (link webcal://).

    Expande eventos que se repetem e devolve horários já no fuso da cidade,
    no formato "2026-11-26T14:00", que o iPad lê sem depender do seu fuso.
    """
    import icalendar
    import recurring_ical_events
    from zoneinfo import ZoneInfo
    fuso = ZoneInfo(cfg.get("fuso", "America/Sao_Paulo"))
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    cal = icalendar.Calendar.from_ical(baixar(url, timeout=30))
    agora = datetime.now(fuso)
    hoje = agora.date()
    ate = hoje + timedelta(days=cfg.get("dias_agenda", 14) + 1)

    def local(v):
        if isinstance(v, datetime):
            if v.tzinfo is None:  # horário "flutuante": já é hora local
                return v.replace(tzinfo=fuso)
            return v.astimezone(fuso)
        return datetime.combine(v, time(0, 0), fuso)  # dia inteiro

    saida = []
    for ev in recurring_ical_events.of(cal).between(hoje - timedelta(days=1), ate):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED":
            continue
        ini = ev.decoded("DTSTART")
        dia_todo = not isinstance(ini, datetime)
        if ev.get("DTEND") is not None:
            fim = ev.decoded("DTEND")
        elif ev.get("DURATION") is not None:
            fim = ini + ev.decoded("DURATION")
        else:
            fim = ini + timedelta(days=1) if dia_todo else ini
        ini, fim = local(ini), local(fim)
        if fim <= agora and not (fim == ini and ini > agora - timedelta(hours=1)):
            continue  # já terminou (sem duração: fica até 1 h depois)
        lugar = limpar(str(ev.get("LOCATION", ""))).split(",")[0].strip()
        e = {"titulo": limpar(str(ev.get("SUMMARY", ""))) or "(sem título)",
             "inicio": ini.strftime("%Y-%m-%dT%H:%M"),
             "fim": fim.strftime("%Y-%m-%dT%H:%M"),
             "dia_todo": dia_todo}
        if lugar:
            e["local"] = lugar[:60]
        saida.append(e)
    saida.sort(key=lambda e: (e["inicio"], not e["dia_todo"], e["titulo"].lower()))
    return saida[:cfg.get("max_eventos", 8)]


def noticias(feed):
    raiz = ET.fromstring(baixar(feed["url"]))
    itens = []
    for item in raiz.iter("item"):
        titulo = limpar(item.findtext("title"))
        fonte = feed["nome"]
        src = item.find("source")
        if src is not None and src.text:
            fonte = src.text.strip()
            # Google Notícias põe " - Fonte" no fim do título
            if titulo.endswith(" - " + fonte):
                titulo = titulo[: -len(" - " + fonte)]
        quando = None
        pub = item.findtext("pubDate")
        if pub:
            try:
                quando = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat()
            except (TypeError, ValueError):
                pass
        if titulo:
            n = {"titulo": titulo, "fonte": fonte, "quando": quando}
            img = imagem_do_item(item)
            if img:
                n["imagem_url"] = img
            itens.append(n)
    return itens


def intercalar(listas, maximo):
    """Pega uma de cada fonte por vez, sem repetir títulos."""
    saida, vistos = [], set()
    i = 0
    while len(saida) < maximo and any(i < len(l) for l in listas):
        for l in listas:
            if i < len(l) and len(saida) < maximo:
                chave = l[i]["titulo"].lower()
                if chave not in vistos:
                    vistos.add(chave)
                    saida.append(l[i])
        i += 1
    return saida


def main():
    senha = os.environ.get("PAINEL_SENHA")
    if not senha:
        sys.exit("Falta a senha do painel (segredo PAINEL_SENHA). Nada foi publicado.")
    chave = chave_da_senha(senha)

    with open(os.path.join(RAIZ, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)

    destino = os.path.join(RAIZ, "data.json")
    anterior = {}
    if os.path.exists(destino):
        with open(destino, encoding="utf-8") as f:
            anterior = json.load(f)

    dados = {
        "gerado_em": datetime.now(timezone.utc).isoformat(),
        "cidade": cfg["cidade"],
        "latitude": cfg["latitude"],
        "longitude": cfg["longitude"],
    }

    try:
        dados["tempo"] = tempo(cfg)
    except Exception as e:  # mantém o último dado bom
        print("Falha no tempo:", e, file=sys.stderr)
        dados["tempo"] = anterior.get("tempo")

    try:
        dados["dolar"] = dolar()
    except Exception as e:  # mantém o último dado bom
        print("Falha no dólar:", e, file=sys.stderr)
        dados["dolar"] = anterior.get("dolar")

    listas = []
    for feed in cfg["feeds"]:
        try:
            listas.append(noticias(feed))
        except Exception as e:
            print("Falha no feed", feed["nome"], e, file=sys.stderr)
    selecionadas = intercalar(listas, cfg.get("max_noticias", 18))
    miniaturas(selecionadas)
    dados["noticias"] = selecionadas or anterior.get("noticias", [])
    try:
        lista = fotos(cfg, chave)
    except Exception as e:  # Drive fora do ar: mantém as fotos de antes
        print("Falha nas fotos:", e, file=sys.stderr)
        lista = None
    if lista is None:  # usa as fotos que já estavam prontas (cache)
        pasta = os.path.join(RAIZ, PASTA_RETRATOS)
        lista = [PASTA_RETRATOS + "/" + n for n in sorted(os.listdir(pasta))] if os.path.isdir(pasta) else []
    dados["fotos"] = lista

    url_agenda = os.environ.get("AGENDA_APPLE_URL", "").strip()
    if url_agenda:
        try:
            dados["agenda"] = agenda(cfg, url_agenda)
        except Exception as e:  # iCloud fora do ar: mantém a última agenda boa
            print("Falha na agenda:", e, file=sys.stderr)
            dados["agenda"] = anterior.get("agenda")
    else:
        print("Agenda: AGENDA_APPLE_URL não configurado", file=sys.stderr)

    with open(destino, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
    # Só a versão cifrada vai para o site
    with open(os.path.join(RAIZ, "dados.txt"), "w") as f:
        f.write(cifrar(chave, json.dumps(dados, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
    print("OK:", len(dados["noticias"]), "notícias,",
          sum(1 for n in dados["noticias"] if n.get("imagem")), "com imagem;", len(dados["fotos"]), "fotos;",
          len(dados["agenda"]) if dados.get("agenda") is not None else "sem", "compromissos;", "tempo", "ok" if dados["tempo"] else "indisponível",
          "· dólar", dados["dolar"]["valor"] if dados.get("dolar") else "indisponível")


if __name__ == "__main__":
    main()
