#!/usr/bin/env python3
"""Gera painel/data.json com previsão do tempo e notícias.

Roda no GitHub Actions (ou localmente). Usa só a biblioteca padrão.
O iPad só precisa ler esse JSON, que fica no mesmo site do painel:
assim evitamos problemas de CORS e de certificados no Safari antigo.
"""
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
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


def limpar(texto):
    texto = re.sub(r"<[^>]+>", " ", texto or "")
    return re.sub(r"\s+", " ", html.unescape(texto)).strip()


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
            itens.append({"titulo": titulo, "fonte": fonte, "quando": quando})
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

    listas = []
    for feed in cfg["feeds"]:
        try:
            listas.append(noticias(feed))
        except Exception as e:
            print("Falha no feed", feed["nome"], e, file=sys.stderr)
    dados["noticias"] = intercalar(listas, cfg.get("max_noticias", 18)) or anterior.get("noticias", [])

    with open(destino, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
    print("OK:", len(dados["noticias"]), "notícias;", "tempo", "ok" if dados["tempo"] else "indisponível")


if __name__ == "__main__":
    main()
