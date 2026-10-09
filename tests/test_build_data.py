import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_data import (TARIFFS_CENTS as T, build, category_of, load_localities, parse_date,
                        parse_side, read_table, row_effects)

RES, COM, SOC, PC = T["Residencial"], T["Comercial"], T["Social"], T["Pequeno comércio"]


def rec(**fields):
    return {k.upper(): v for k, v in fields.items()}


def lines(rows, places=None, **kw):
    return build(rows, places, **kw)[0]["lines"]


def total(items, **where):
    return sum(i["cents"] * i["factor"] for i in items if all(i[k] == v for k, v in where.items()))


class ParsingTest(unittest.TestCase):
    def test_categories(self):
        for text, expected in [("RESIDENCIAL", "Residencial"), ("Res. Social", "Social"),
                               ("P. COMERCIO", "Pequeno comércio"), ("Pequeno Comércio", "Pequeno comércio"),
                               ("Comércio Popular", "Comércio popular"), ("COMERCIAL", "Comercial"),
                               ("PÚBLICA", "Pública"), ("Publica", "Pública"), ("banana", "Outros")]:
            self.assertEqual(category_of(text), expected, text)

    def test_sides(self):
        self.assertEqual(parse_side("2 RESIDENCIAL"), (2, "Residencial"))
        self.assertEqual(parse_side("3 economias residenciais;"), (3, "Residencial"))
        self.assertEqual(parse_side("2", fallback="Comercial"), (2, "Comercial"))
        self.assertEqual(parse_side("0"), (0, None))
        self.assertEqual(parse_side("2 banana"), (2, "Outros"))
        self.assertIsNone(parse_side("RESIDENCIAL"))
        self.assertIsNone(parse_side("1 RES E 1 COM"))  # duas categorias no mesmo campo

    def test_dates(self):
        self.assertEqual(parse_date("15/07/2026 14:30").month, 7)
        self.assertEqual(parse_date("2026-07-15 14:30:00").day, 15)
        self.assertEqual(parse_date(46218.5).year, 2026)
        self.assertIsNone(parse_date("ontem"))


class EffectsTest(unittest.TestCase):
    def one(self, **fields):
        effects, reason, _ = row_effects(rec(**fields))
        self.assertIsNone(reason)
        return effects

    def test_economy_increment_same_category(self):
        self.assertEqual(self.one(de="2 RESIDENCIAL", para="5 RESIDENCIAL"),
                         [("economia", "Residencial", "Residencial", 3, 3 * RES)])

    def test_economy_decrement_same_category(self):
        self.assertEqual(self.one(de="14 RES", para="1 RES"), [("economia", "Residencial", "Residencial", -13, -13 * RES)])

    def test_economy_decrement_with_category_change_follows_model_formula(self):
        # Valor Decremento = diferença x (tarifa DE - tarifa PARA): -1 x (85,41 - 443,57) = +358,16
        self.assertEqual(self.one(de="2 RES", para="1 COM"), [("economia", "Residencial", "Comercial", -1, COM - RES)])

    def test_economy_increment_with_category_change(self):
        self.assertEqual(self.one(de="1 RES", para="3 COM"), [("economia", "Residencial", "Comercial", 2, 2 * (COM - RES))])

    def test_category_swap_uses_quantity(self):
        self.assertEqual(self.one(anterior="Residencial", atual="Comercial", quantidade=2),
                         [("categoria", "Residencial", "Comercial", 2, 2 * (COM - RES))])

    def test_unknown_category_is_other_with_zero_tariff(self):
        self.assertEqual(self.one(anterior="Comercial", atual="Outros", quantidade=1),
                         [("categoria", "Comercial", "Outros", 1, -COM)])

    def test_same_category_swap_is_ignored(self):
        self.assertEqual(self.one(anterior="Residencial", atual="RES.", quantidade=1), [])

    def test_same_count_different_category_is_reported_not_valued(self):
        self.assertEqual(row_effects(rec(de="1 RES", para="1 COM")), ([], None, "troca_sem_variacao"))

    def test_pending_reasons(self):
        self.assertEqual(row_effects(rec(de="2 RES"))[1], "incompleto")
        self.assertEqual(row_effects(rec(de="1 RES E 1 COM", para="2 RES"))[1], "nao_reconhecido")
        self.assertEqual(row_effects(rec(anterior="Social", atual="Residencial"))[1], "quantidade_invalida")
        self.assertEqual(row_effects(rec(anterior="Social", atual="Residencial", quantidade=1.5))[1], "quantidade_invalida")

    def test_row_without_value_fields_is_ignored(self):
        self.assertEqual(row_effects(rec(tipo_de_alteracao="Encerrado sem tratativa")), ([], None, None))


class PowerBiReproductionTest(unittest.TestCase):
    """Reproduz os quatro quadros de SET/2026 do relatório Power BI, com os textos reais da planilha."""

    @staticmethod
    def september(**kw):
        done, inc, dec = "2026-09-15 10:00:00", "Incremento", "Decremento"
        economy = [  # (de, para, marcação no Forms)
            ("1 Comercial", "3 Comerciais", inc), ("1 Residência", "75 Residências", inc),
            ("3 Comerciais", "1 Comercial", dec), ("3 Residências", "2 Comércios", dec),
            ("14 Residências", "1 Residência", dec),
            ("1 Comercial", "2 Residências", dec),  # aumento marcado como "Decremento": fora do relatório
        ]
        category = [  # (anterior, atual, total)
            ("P. Comercio", "Comercial", 11), ("P. Comercio", "COMÉRCIO POPULAR", 6), ("Residencial", "Comercial", 4),
            ("Residencial", "P. Comercio", 2), ("Social", "P. Comercio", 1), ("Social", "Residencial", 54),
            ("Comercial", "ENT.S/FIM LUCRATIVO", 1), ("Comercial", "P. Comercio", 10), ("Comercial", "Residencial", 5),
            ("Comercial", "comércio popular", 1), ("P. Comercio", "Publica", 1), ("P. Comercio", "Residencial", 3),
            ("Residencial", "Social", 52),
        ]
        rows = [rec(horadeconclusao=done, de=d, para=p, qualfoiaalteracaodeeconomia=f) for d, p, f in economy]
        rows += [rec(horadeconclusao=done, anterior=a, atual=b, quantidade=q) for a, b, q in category]
        return lines(rows, **kw)

    def test_four_tables_match_the_report(self):
        items = self.september(powerbi=True)
        self.assertEqual(total(items, kind="economia", dir="inc"), 720748)    # R$ 7.207,48
        self.assertEqual(total(items, kind="categoria", dir="inc"), 865313)   # R$ 8.653,13
        self.assertEqual(total(items, kind="economia", dir="dec"), -163931)   # -R$ 1.639,31
        self.assertEqual(total(items, kind="categoria", dir="dec"), -795824)  # -R$ 7.958,24
        self.assertEqual(total(items), 626306)                                # R$ 6.263,06 (rodapé do print)
        self.assertEqual(sum(i["qty"] for i in items if i["kind"] == "economia" and i["dir"] == "inc"), 76)
        self.assertEqual(sum(i["qty"] for i in items if i["kind"] == "categoria" and i["dir"] == "inc"), 78)
        self.assertEqual(sum(i["qty"] for i in items if i["kind"] == "categoria" and i["dir"] == "dec"), 72)

    def test_corrected_rules_value_the_same_rows_with_the_real_tariffs(self):
        # Mesmas linhas, sem as particularidades do relatório: comércio popular a R$ 60,24 (não Comercial),
        # Pública a R$ 129,16 (não R$ 0) e o aumento "1 Comercial -> 2 Residências" também entra.
        items = self.september()
        self.assertEqual(total(items), 335075)  # R$ 3.350,75, o mesmo da planilha real em SET/2026


class BuildTest(unittest.TestCase):
    ROWS = [
        rec(horadeconclusao="2026-07-10 10:00:00", matriculasdigito="100", de="1 RES", para="2 RES"),
        rec(horadeconclusao="2026-07-11 10:00:00", matriculasdigito="101", anterior="Residencial", atual="Comercial", quantidade=2),
        rec(horadeconclusao="2026-07-12 10:00:00", matriculasdigito="102", de="2 RES", para="1 RES"),
        rec(horadeconclusao="2026-07-13 10:00:00", matriculasdigito="103", anterior="Comercial", atual="Residencial", quantidade=1),
        rec(horadeconclusao="2026-07-14 10:00:00", matriculasdigito="104"),                 # sem valor
        rec(horadeconclusao="2026-07-15 10:00:00", matriculasdigito="105", de="2 RES"),     # incompleta
    ]

    def test_aggregation_without_client_base(self):
        feed, _, _ = build(self.ROWS)
        self.assertEqual(feed["months"], ["2026-07"])
        got = {(i["kind"], i["dir"]): (i["qty"], i["cents"]) for i in feed["lines"]}
        self.assertEqual(got[("economia", "inc")], (1, RES))
        self.assertEqual(got[("economia", "dec")], (-1, -RES))
        self.assertEqual(got[("categoria", "inc")], (2, 2 * (COM - RES)))
        self.assertEqual(got[("categoria", "dec")], (1, -(COM - RES)))
        self.assertEqual(feed["pending"], [dict(month="2026-07", city="Não identificada", reason="incompleto", count=1)])

    def test_water_and_sewage_doubles_selected_cities(self):
        places = {"100": "Cordeiro", "101": "Rio Bonito", "102": "APERIBÉ", "103": "Rio Bonito"}
        items = lines(self.ROWS, places)
        by = {(i["city"], i["kind"], i["dir"]): i for i in items}
        self.assertEqual(by[("Cordeiro", "economia", "inc")]["factor"], 2)
        self.assertEqual(total(items, city="Cordeiro"), 2 * RES)
        self.assertEqual(total(items, city="APERIBÉ"), -2 * RES)
        self.assertEqual(by[("Rio Bonito", "categoria", "inc")]["factor"], 1)

    def test_unknown_matricula_is_billed_as_water_only(self):
        item = lines(self.ROWS[:1], places={})[0]
        self.assertEqual((item["city"], item["factor"]), ("Não identificada", 1))

    def test_row_with_no_date_goes_to_pending(self):
        feed, _, _ = build([rec(horadeconclusao="", de="1 RES", para="2 RES")])
        self.assertEqual(feed["pending"][0]["reason"], "sem_data")
        self.assertEqual(feed["lines"], [])

    def test_month_filters(self):
        rows = self.ROWS + [rec(horadeconclusao="2026-08-01 08:00:00", de="1 RES", para="2 RES")]
        self.assertEqual(build(rows, until="2026-07")[0]["months"], ["2026-07"])
        self.assertEqual(build(rows, since="2026-08")[0]["months"], ["2026-08"])


class FilesTest(unittest.TestCase):
    def test_csv_with_semicolons_and_client_base(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "t.csv").write_text(
                "Id;Hora de conclusão;MATRICULA S/ DIGITO;DE:;PARA:;ANTERIOR;ATUAL;QUANTIDADE\n"
                "1;15/07/2026 10:00;0100;1 RES;2 RES;;;\n"
                "2;16/07/2026 10:00;0101;;;Residencial;Comercial;2\n", encoding="utf-8")
            (tmp / "c.csv").write_text("N° da Ligação,Localidade\n100,Cordeiro\n101,Rio Bonito\n", encoding="utf-8")
            _, rows = read_table(tmp / "t.csv")
            self.assertEqual(rows[0]["DE"], "1 RES")
            items = lines(rows, load_localities(tmp / "c.csv"))
            self.assertEqual(total(items, city="Cordeiro"), 2 * RES)            # água + esgoto
            self.assertEqual(total(items, city="Rio Bonito"), 2 * (COM - RES))  # só água


if __name__ == "__main__":
    unittest.main()
