import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_data import (TARIFFS_CENTS as T, build, category_of, decompose, load_clients, parse_date, parse_narrative, parse_units,
                        parse_side, read_table, row_effects, Client, POWERBI_TARIFFS_CENTS)

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
                               ("PÚBLICA", "Pública"), ("Publica", "Pública"), ("banana", "Outros"),
                               ("CADÚNICO", "Social"), ("ENT.S/FIM LUCRATIVO", "Pública"),
                               ("SEM FINS LUCRATIVOS", "Pública"), ("Entidade sem fins lucrativos", "Pública")]:
            self.assertEqual(category_of(text), expected, text)
        # o modo do relatório não conhece essas regras
        self.assertEqual(category_of("CADÚNICO", powerbi=True), "Outros")
        self.assertEqual(category_of("ENT.S/FIM LUCRATIVO", powerbi=True), "Outros")

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

    def test_cadunico_to_social_is_not_a_change(self):
        self.assertEqual(self.one(anterior="CADÚNICO", atual="Social", quantidade=1), [])

    def test_nonprofit_entity_pays_the_public_tariff(self):
        PUB = T["Pública"]
        self.assertEqual(self.one(anterior="Comercial", atual="SEM FINS LUCRATIVOS", quantidade=1),
                         [("categoria", "Comercial", "Pública", 1, PUB - COM)])
        self.assertEqual(self.one(anterior="Residencial", atual="ENTIDADE SEM FINS LUCRATIVOS", quantidade=1),
                         [("categoria", "Residencial", "Pública", 1, PUB - RES)])

    def test_text_quantity_is_read_as_before_and_after(self):
        # 1 residencial social -> 2 residenciais normais: uma troca social->residencial e uma economia nova
        effects = self.one(anterior="Social", atual="Residencial", quantidade="DE 1 RES. SOCIAL P/ 2 RES. NORMAIS")
        self.assertEqual(sorted(e[0] for e in effects), ["categoria", "economia"])
        self.assertEqual(sum(e[4] for e in effects), 2 * RES - SOC)
        # 1 residência continua e entram 2 comerciais
        effects = self.one(anterior="Residencial", atual="Comercial", quantidade="DE 1 RES. P/ 1 RES. E 2 COM.")
        self.assertEqual(effects, [("economia", "Comercial", "Comercial", 1, COM)] * 2)
        # sem o modo do relatório a linha é ignorada, como no Power BI
        self.assertEqual(row_effects(rec(anterior="Residencial", atual="Comercial", quantidade="DE 1 RES. P/ 1 RES. E 2 COM."),
                                     powerbi=True)[1], "quantidade_invalida")

    def test_text_quantity_without_categories_stays_pending(self):
        for text in ("DE 2 ECONOMIAS PARA 1 ECONOMIA", "1 RES.", "ALT. DE 2 P/ 1 RES. SOCIAL"):
            self.assertEqual(row_effects(rec(anterior="Residencial", atual="Comercial", quantidade=text))[1],
                             "quantidade_invalida", text)

    def test_field_with_two_categories_uses_the_difference_per_category(self):
        # 1 residência -> 6 residências e 1 comercial: +5 residenciais e +1 comercial
        effects = self.one(de="1 Residência", para="6RES. E 1 COM.")
        self.assertEqual(sum(e[3] for e in effects), 6)
        self.assertEqual(sum(e[4] for e in effects), 5 * RES + COM)

    def test_narrative_typed_into_de_para(self):
        # o mesmo texto "DE 5 RES. E 1 COM. P/ 4 RES. E 1 COM." nos dois campos: sai uma residência
        text = "DE 5 RES. E 1 COM. P/ 4 RES. E 1 COM."
        self.assertEqual(self.one(de=text, para=text), [("economia", "Residencial", "Residencial", -1, -RES)])

    def test_decompose_and_narrative_parsing(self):
        self.assertEqual(parse_narrative("de 1 res. p/ 1 res. e 1 com."), (parse_units("1 RES"), parse_units("1 RES E 1 COM")))
        self.assertIsNone(parse_narrative("1 RES. E 1 COM."))
        self.assertEqual(decompose(parse_units("1 SOC"), parse_units("2 RES")),
                         [("troca", "Social", "Residencial", 1), ("nova", None, "Residencial", 1)])

    def test_pending_reasons(self):
        self.assertEqual(row_effects(rec(de="2 RES"))[1], "incompleto")
        self.assertEqual(row_effects(rec(de="1 RES E 1 COM", para="2 RES"), powerbi=True)[1], "nao_reconhecido")
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
        # Mesmas linhas, sem as particularidades do relatório: tarifas oficiais, comércio popular a R$ 60,24
        # (não Comercial), Pública a R$ 129,15 (não R$ 0), "sem fins lucrativos" como Pública e o aumento
        # "1 Comercial -> 2 Residências" também entra. Conta feita à mão: economias 521.001 + categorias -173.010.
        items = self.september()
        self.assertEqual(total(items), 347991)  # R$ 3.479,91
        self.assertEqual(total(items, kind="economia"), 521001)
        self.assertEqual(total(items, kind="categoria"), -173010)

    def test_powerbi_mode_uses_the_model_tariffs(self):
        self.assertEqual(POWERBI_TARIFFS_CENTS["Comercial"], T["Comercial"] + 1)
        items = lines([rec(horadeconclusao="2026-09-15 10:00:00", de="1 Comercial", para="3 Comerciais",
                           qualfoiaalteracaodeeconomia="Incremento")], powerbi=True)
        self.assertEqual(total(items), 2 * POWERBI_TARIFFS_CENTS["Comercial"])


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

    def test_identical_rows_with_the_same_id_count_once(self):
        row = rec(id=7, horadeconclusao="2026-07-10 10:00:00", de="1 RES", para="2 RES")
        other = rec(id=8, horadeconclusao="2026-07-10 11:00:00", de="1 RES", para="2 RES")
        changed = dict(row, PARA="3 RES")  # mesmo Id, conteúdo diferente: não é cópia, fica
        feed, _, notes = build([row, dict(row), other, changed])
        self.assertEqual(notes["id_repetido"], 1)
        self.assertEqual(sum(l["cents"] for l in feed["lines"]), RES + RES + 2 * RES)
        # o modo do relatório não remove nada
        flagged = dict(row, QUALFOIAALTERACAODEECONOMIA="Incremento")
        self.assertEqual(sum(l["qty"] for l in build([flagged, dict(flagged)], powerbi=True)[0]["lines"] if l["dir"] == "inc"), 2)

    def test_month_filters(self):
        rows = self.ROWS + [rec(horadeconclusao="2026-08-01 08:00:00", de="1 RES", para="2 RES")]
        self.assertEqual(build(rows, until="2026-07")[0]["months"], ["2026-07"])
        self.assertEqual(build(rows, since="2026-08")[0]["months"], ["2026-08"])


class ClientBaseTest(unittest.TestCase):
    ROWS = [
        rec(horadeconclusao="2026-07-10 10:00:00", matriculasdigito="100", de="1 RES", para="2 RES"),
        rec(horadeconclusao="2026-07-11 10:00:00", matriculasdigito="101", de="1 RES", para="2 RES"),
        rec(horadeconclusao="2026-07-12 10:00:00", matriculasdigito="999", de="1 RES", para="2 RES"),  # fora da base
    ]

    def test_billing_type_of_the_connection_decides_the_double_not_the_city(self):
        places = {"100": Client("Cordeiro", False), "101": Client("Rio Bonito", True)}
        items = lines(self.ROWS, places)
        by = {i["city"]: i for i in items}
        self.assertEqual(by["Cordeiro"]["factor"], 1)   # Cordeiro, mas só água
        self.assertEqual(by["Rio Bonito"]["factor"], 2)  # outra cidade, mas água e esgoto
        self.assertEqual(by["Não identificada"]["factor"], 1)

    def test_coverage_counts_how_many_valued_rows_were_found(self):
        places = {"100": Client("Cordeiro", False), "101": Client("Rio Bonito", True)}
        feed, _, notes = build(self.ROWS, places)
        self.assertEqual(feed["source"]["coverage"], {"found": 2, "total": 3})
        self.assertEqual(feed["source"]["billing"], "ligacao")
        self.assertEqual(notes["cobertura_double"], 1)

    def test_city_rule_is_the_fallback_when_the_base_has_no_billing_column(self):
        feed, _, _ = build(self.ROWS[:2], {"100": Client("Cordeiro", None), "101": Client("Rio Bonito", None)})
        self.assertEqual({i["city"]: i["factor"] for i in feed["lines"]}, {"Cordeiro": 2, "Rio Bonito": 1})
        self.assertEqual(feed["source"]["billing"], "municipio")

    def test_export_with_monthly_rows_footer_and_type_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "base.csv"
            path.write_text(
                "NUM_LIGACAO,CIDADE,TIPO_LIGACAO,TIPO_FATURAMENTO,Mês/Ano\n"
                "100,CORDEIRO,HIDROMETRADO,AGUA,08/2026\n"
                "100,CORDEIRO,HIDROMETRADO,AGUA E ESGOTO,09/2026\n"   # mês mais recente vale
                "101,RIO BONITO,CONSUMO FIXO,AGUA,10/2026\n"
                "101,RIO BONITO,CONSUMO FIXO,AGUA E ESGOTO,02/2026\n"
                ',,,,\n"Filtros aplicados: Mês/Ano é 02/2026",,,,\n', encoding="utf-8")
            clients = load_clients(path)
            self.assertEqual(clients["100"], Client("CORDEIRO", True))
            self.assertEqual(clients["101"], Client("RIO BONITO", False))
            self.assertEqual(len(clients), 2)


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
            items = lines(rows, load_clients(tmp / "c.csv"))
            self.assertEqual(total(items, city="Cordeiro"), 2 * RES)            # água + esgoto
            self.assertEqual(total(items, city="Rio Bonito"), 2 * (COM - RES))  # só água


if __name__ == "__main__":
    unittest.main()
