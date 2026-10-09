#!/usr/bin/env python3
"""Cria dados SINTÉTICOS (fictícios) no mesmo formato da tabela TRATATIVAS, em exemplo/.

Serve para testar o painel e mostrar o formato esperado da exportação. Não contém clientes reais.
Uso: python scripts/gerar_exemplo.py && python scripts/build_data.py exemplo/TRATATIVAS_exemplo.csv \
        --clientes exemplo/BASE_CLIENTES_exemplo.csv --exemplo
"""

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "exemplo"
rng = random.Random(2026)

CITIES = ["Cordeiro", "Miracema", "Aperibé", "Cantagalo", "Itaocará", "Rio Bonito"]
CITY_WEIGHT = [3, 3, 2, 3, 3, 3]
CAT = {"Residencial": "RESIDENCIAL", "Comercial": "COMERCIAL", "Social": "SOCIAL",
       "Pequeno comércio": "P. COMERCIO", "Industrial": "INDUSTRIAL", "Pública": "PUBLICA"}
CAT_WEIGHT = [10, 3, 4, 3, 1, 1]
MONTHS = [(2026, m) for m in range(3, 10)]  # mar a set
VOLUME = {3: 90, 4: 110, 5: 95, 6: 120, 7: 80, 8: 130, 9: 125}
FRENTES = ["CADASTRO"]


def pick_cat():
    return rng.choices(list(CAT), CAT_WEIGHT)[0]


def main():
    OUT.mkdir(exist_ok=True)
    customers = []
    with (OUT / "BASE_CLIENTES_exemplo.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["N° da Ligação", "Localidade"])
        for i in range(1200):
            ident = 5000000 + i * 7
            city = rng.choices(CITIES, CITY_WEIGHT)[0]
            customers.append(ident)
            w.writerow([ident, city.upper()])

    header = ["Id", "Hora de início", "Hora de conclusão", "Colaborador", "MATRICULA S/ DIGITO",
              "FRENTE DE SERVIÇO", "TIPO DE ALTERAÇÃO", "TIPO DE ECONOMIA",
              "DE:", "PARA:", "ANTERIOR", "ATUAL", "QUANTIDADE"]
    rows, n = [], 0
    for year, month in MONTHS:
        for _ in range(VOLUME[month]):
            n += 1
            day = rng.randint(1, 27)
            done = datetime(year, month, day, rng.randint(8, 17), rng.randint(0, 59))
            row = [n, (done - timedelta(minutes=rng.randint(2, 20))).strftime("%Y-%m-%d %H:%M:%S"),
                   done.strftime("%Y-%m-%d %H:%M:%S"), f"Assistente {rng.randint(1, 5)}",
                   rng.choice(customers), "CADASTRO", "", "", "", "", "", "", ""]
            kind = rng.random()
            if kind < 0.30:  # economias novas
                cat, before = pick_cat(), rng.randint(1, 3)
                row[6:9] = ["Alteração de economias", cat, f"{before} {CAT[cat]}"]
                row[9] = f"{before + rng.choice([1, 1, 1, 2, 3])} {CAT[cat]}"
            elif kind < 0.40:  # economias retiradas
                cat, before = pick_cat(), rng.randint(2, 4)
                row[6:9] = ["Alteração de economias", cat, f"{before} {CAT[cat]}"]
                row[9] = f"{before - 1} {CAT[cat]}"
            elif kind < 0.80:  # troca de categoria
                a, b = rng.sample(list(CAT), 2)
                row[6:8] = ["Alteração de categoria", a]
                row[10:13] = [a, b, rng.choice([1, 1, 1, 2])]
            # restante: tratativa sem efeito de valor ("Encerrado sem tratativa")
            else:
                row[6] = "Encerrado sem tratativa"
            rows.append(row)

    with (OUT / "TRATATIVAS_exemplo.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"{OUT}: {len(rows)} tratativas fictícias e 1200 clientes fictícios")


if __name__ == "__main__":
    main()
