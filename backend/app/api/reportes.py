"""
API: Reportes
Exportacion de combates guardados en PDF y Excel.
"""
import io
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.usuario import Usuario
from ..models.combate import Combate
from ..models.tatami import Tatami, SesionTatami
from ..models.campeonato import Campeonato

reportes_bp = Blueprint("reportes", __name__)


def _require_admin():
    uid = get_jwt_identity()
    user = Usuario.query.get(int(uid))
    if not user or user.rol != "admin":
        return None
    return user


def _build_query(args):
    """Construye query de combates con filtros opcionales."""
    q = db.session.query(Combate).join(
        SesionTatami, Combate.sesion_tatami_id == SesionTatami.id
    ).join(
        Tatami, SesionTatami.tatami_id == Tatami.id
    )

    if args.get("campeonato_id"):
        q = q.filter(Tatami.campeonato_id == int(args["campeonato_id"]))
    if args.get("tatami_id"):
        q = q.filter(SesionTatami.tatami_id == int(args["tatami_id"]))
    if args.get("categoria_id"):
        q = q.filter(Combate.categoria_id == int(args["categoria_id"]))
    if args.get("desde"):
        try:
            desde = datetime.fromisoformat(args["desde"])
            q = q.filter(Combate.created_at >= desde)
        except Exception:
            pass
    if args.get("hasta"):
        try:
            hasta = datetime.fromisoformat(args["hasta"])
            q = q.filter(Combate.created_at <= hasta)
        except Exception:
            pass

    q = q.order_by(Combate.created_at.desc())
    return q


def _format_momento_evento(entrada):
    """Formatea el timestamp real de una entrada del historial."""
    momento = entrada.get("momento") or entrada.get("ts")
    if not momento:
        return "-"
    if isinstance(momento, (int, float)):
        try:
            return datetime.fromtimestamp(momento / 1000, tz=timezone.utc).strftime(
                "%d/%m/%Y %H:%M:%S"
            )
        except Exception:
            return str(momento)
    if isinstance(momento, str):
        return momento.replace("T", " ")[:19]
    return str(momento)


def _jueces_meta(combate):
    detalle = combate.jueces_detalle or {}
    return detalle.get("asignaciones") or detalle.get("jueces_meta") or {}


def _juez_meta_para_evento(combate, entrada):
    rol = entrada.get("juez_rol") or entrada.get("juez")
    meta = _jueces_meta(combate).get(rol, {})
    return {
        "nombre": entrada.get("juez_nombre") or meta.get("nombre") or rol or "-",
        "email": entrada.get("juez_email") or meta.get("email") or "-",
        "asignacion": entrada.get("juez_asignacion") or meta.get("asignacion") or rol or "-",
        "rol": rol or "-",
        "acceso": entrada.get("juez_acceso") or meta.get("origen") or "-",
    }


def _jueces_list(combate):
    jueces = []
    for rol, meta in sorted(_jueces_meta(combate).items()):
        jueces.append({
            "rol_tatami": meta.get("rol_tatami") or rol,
            "asignacion": meta.get("asignacion") or rol,
            "nombre": meta.get("nombre") or "-",
            "email": meta.get("email") or "-",
            "origen": meta.get("origen") or "-",
            "asignado_at": meta.get("asignado_at"),
            "asignado_por": meta.get("asignado_por"),
        })
    return jueces


def _jueces_resumen(combate):
    partes = []
    for juez in _jueces_list(combate):
        email = juez["email"] if juez["email"] != "-" else ""
        origen = "PIN" if juez["origen"] == "pin" else "Asignado"
        partes.append(
            f"{juez['asignacion']}: {juez['nombre']}"
            + (f" <{email}>" if email else "")
            + f" ({origen})"
        )
    return "; ".join(partes) if partes else "-"


@reportes_bp.route("/combates", methods=["GET"])
@jwt_required()
def listar_combates():
    """GET /api/reportes/combates — Lista combates guardados con filtros."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))

    q = _build_query(request.args)
    total = q.count()
    combates = q.offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for c in combates:
        sesion = SesionTatami.query.get(c.sesion_tatami_id)
        tatami = Tatami.query.get(sesion.tatami_id) if sesion else None
        camp = Campeonato.query.get(tatami.campeonato_id) if tatami else None

        result.append({
            "id": c.id,
            "nombre_hong": c.nombre_hong,
            "nombre_chung": c.nombre_chung,
            "marcador_hong": float(c.marcador_hong or 0),
            "marcador_chung": float(c.marcador_chung or 0),
            "ganador": c.ganador,
            "ronda_final": c.ronda_final,
            "num_jueces": c.num_jueces,
            "duracion_segundos": c.duracion_segundos,
            "tatami_numero": tatami.numero if tatami else None,
            "campeonato_nombre": camp.nombre if camp else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "fin": c.fin.isoformat() if c.fin else None,
            "historial_completo": c.historial_completo or [],
            "jueces_detalle": c.jueces_detalle or {},
            "jueces": _jueces_list(c),
            "jueces_resumen": _jueces_resumen(c),
        })

    return jsonify({
        "combates": result,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }), 200


@reportes_bp.route("/combates/export/excel", methods=["GET"])
@jwt_required()
def exportar_excel():
    """GET /api/reportes/combates/export/excel — Exportar combates en Excel."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        return jsonify({"error": "openpyxl no instalado"}), 500

    q = _build_query(request.args)
    combates = q.all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Combates DINAMYT"

    # Estilos
    header_font = Font(name="Arial", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1A1A2E", end_color="1A1A2E", fill_type="solid")
    hong_fill = PatternFill(start_color="FFE5E8", end_color="FFE5E8", fill_type="solid")
    chung_fill = PatternFill(start_color="E5EEFF", end_color="E5EEFF", fill_type="solid")
    center = Alignment(horizontal="center", vertical="center")
    border = Border(
        left=Side(style="thin", color="DDDDDD"),
        right=Side(style="thin", color="DDDDDD"),
        top=Side(style="thin", color="DDDDDD"),
        bottom=Side(style="thin", color="DDDDDD"),
    )

    # Titulo
    ws.merge_cells("A1:M1")
    titulo = ws["A1"]
    titulo.value = f"DINAMYT — Reporte de Combates — {datetime.now().strftime('%d/%m/%Y %H:%M')}"
    titulo.font = Font(name="Arial", bold=True, size=13, color="1A1A2E")
    titulo.alignment = center

    # Headers
    headers = [
        "ID", "Campeonato", "Tatami", "Hong (Rojo)", "Chung (Azul)",
        "Pts Hong", "Pts Chung", "Ganador", "Ronda Final",
        "Jueces Esquina", "Duracion (s)", "Fecha/Hora", "Jueces"
    ]
    row = 3
    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=row, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
        cell.border = border

    ws.row_dimensions[row].height = 24

    # Datos
    for combate in combates:
        sesion = SesionTatami.query.get(combate.sesion_tatami_id)
        tatami = Tatami.query.get(sesion.tatami_id) if sesion else None
        camp = Campeonato.query.get(tatami.campeonato_id) if tatami else None

        row += 1
        ganador_nombre = combate.nombre_hong if combate.ganador == "hong" else (
            combate.nombre_chung if combate.ganador == "chung" else "Empate"
        )

        data = [
            combate.id,
            camp.nombre if camp else "-",
            f"Tatami {tatami.numero}" if tatami else "-",
            combate.nombre_hong,
            combate.nombre_chung,
            float(combate.marcador_hong or 0),
            float(combate.marcador_chung or 0),
            ganador_nombre,
            combate.ronda_final or "-",
            combate.num_jueces or 4,
            combate.duracion_segundos or "-",
            combate.created_at.strftime("%d/%m/%Y %H:%M") if combate.created_at else "-",
            _jueces_resumen(combate),
        ]

        for col_idx, value in enumerate(data, 1):
            cell = ws.cell(row=row, column=col_idx, value=value)
            cell.border = border
            cell.alignment = center
            # Color by ganador
            if col_idx in (4, 6) and combate.ganador == "hong":
                cell.fill = hong_fill
            elif col_idx in (5, 7) and combate.ganador == "chung":
                cell.fill = chung_fill

    # Widths
    col_widths = [6, 22, 10, 20, 20, 10, 10, 20, 14, 14, 12, 18, 42]
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = width

    # ── Hoja 2: Detalle de puntos por juez ──────────────────────────────────
    ws2 = wb.create_sheet("Detalle de Puntos")
    det_headers = [
        "Combate ID", "Hong", "Chung", "Rol", "Nombre juez", "Correo",
        "Asignacion", "Acceso", "Color", "Pts", "Accion", "Tiempo (s)",
        "Momento", "Ronda", "Tipo"
    ]
    for col_idx, h in enumerate(det_headers, 1):
        cell = ws2.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
        cell.border = border

    det_row = 2
    for combate in combates:
        historial = combate.historial_completo or []
        for entrada in historial:
            juez_meta = _juez_meta_para_evento(combate, entrada)
            tipo = ""
            if entrada.get("esEspecial"):   tipo = "Especial"
            elif entrada.get("esKyongGo"): tipo = "KyongGo"
            elif entrada.get("esGamJeum"): tipo = "GamJeum"
            else:                           tipo = "Punto Normal"

            det_data = [
                combate.id,
                combate.nombre_hong,
                combate.nombre_chung,
                juez_meta["rol"],
                juez_meta["nombre"],
                juez_meta["email"],
                juez_meta["asignacion"],
                juez_meta["acceso"],
                entrada.get("color", "-"),
                entrada.get("pts", 0),
                entrada.get("nombre", "-"),
                entrada.get("tiempo", "-"),
                _format_momento_evento(entrada),
                entrada.get("ronda", "-"),
                tipo,
            ]
            for col_idx, val in enumerate(det_data, 1):
                cell = ws2.cell(row=det_row, column=col_idx, value=val)
                cell.border = border
                cell.alignment = center
                if entrada.get("color") == "hong":
                    cell.fill = hong_fill
                elif entrada.get("color") == "chung":
                    cell.fill = chung_fill
            det_row += 1

    for i, w in enumerate([10, 20, 20, 10, 24, 30, 18, 12, 8, 8, 22, 10, 20, 8, 14], 1):
        ws2.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    # Output
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"dinamyt_combates_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return send_file(
        output,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )


@reportes_bp.route("/combates/export/pdf", methods=["GET"])
@jwt_required()
def exportar_pdf():
    """GET /api/reportes/combates/export/pdf — Exportar combates en PDF."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    try:
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle, Paragraph,
            Spacer, HRFlowable
        )
    except ImportError:
        return jsonify({"error": "reportlab no instalado"}), 500

    q = _build_query(request.args)
    combates = q.all()

    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=landscape(A4),
        rightMargin=1.5 * cm,
        leftMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    story = []

    # Titulo
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"],
        fontSize=16, textColor=colors.HexColor("#1A1A2E"),
        spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        "Sub", parent=styles["Normal"],
        fontSize=9, textColor=colors.HexColor("#666666"),
        spaceAfter=12,
    )

    story.append(Paragraph("DINAMYT — Reporte de Combates", title_style))
    story.append(Paragraph(
        f"Global Hapkido Alliance &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"Total: {len(combates)} combates",
        sub_style
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#DDDDDD")))
    story.append(Spacer(1, 0.3 * cm))

    # Headers
    col_widths_pdf = [
        1.2*cm, 5*cm, 2.2*cm, 4.5*cm, 4.5*cm,
        2.2*cm, 2.2*cm, 4*cm, 2.5*cm, 3*cm
    ]

    table_data = [["#", "Campeonato", "Tatami", "Hong", "Chung",
                   "Pts H", "Pts C", "Ganador", "Ronda", "Fecha"]]

    for combate in combates:
        sesion = SesionTatami.query.get(combate.sesion_tatami_id)
        tatami = Tatami.query.get(sesion.tatami_id) if sesion else None
        camp = Campeonato.query.get(tatami.campeonato_id) if tatami else None

        ganador = combate.nombre_hong if combate.ganador == "hong" else (
            combate.nombre_chung if combate.ganador == "chung" else "Empate"
        )

        table_data.append([
            str(combate.id),
            camp.nombre if camp else "-",
            f"T{tatami.numero}" if tatami else "-",
            combate.nombre_hong or "-",
            combate.nombre_chung or "-",
            str(float(combate.marcador_hong or 0)),
            str(float(combate.marcador_chung or 0)),
            ganador,
            combate.ronda_final or "-",
            combate.created_at.strftime("%d/%m %H:%M") if combate.created_at else "-",
        ])

    # Colors
    DARK = colors.HexColor("#1A1A2E")
    HONG_BG = colors.HexColor("#FFE5E8")
    CHUNG_BG = colors.HexColor("#E5EEFF")
    GRAY_BG = colors.HexColor("#F5F5F5")
    WHITE = colors.white

    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 7.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, GRAY_BG]),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]

    # Highlight winner cells
    for row_idx, combate in enumerate(combates, 1):
        if combate.ganador == "hong":
            style_cmds.append(("BACKGROUND", (3, row_idx), (3, row_idx), HONG_BG))
            style_cmds.append(("BACKGROUND", (5, row_idx), (5, row_idx), HONG_BG))
        elif combate.ganador == "chung":
            style_cmds.append(("BACKGROUND", (4, row_idx), (4, row_idx), CHUNG_BG))
            style_cmds.append(("BACKGROUND", (6, row_idx), (6, row_idx), CHUNG_BG))

    t = Table(table_data, colWidths=col_widths_pdf, repeatRows=1)
    t.setStyle(TableStyle(style_cmds))
    story.append(t)

    # ── Resumen de jueces por combate ──
    story.append(Spacer(1, 0.7 * cm))
    story.append(Paragraph("Jueces, correo y asignación", title_style))
    jueces_table_data = [["Comb ID", "Jueces"]]
    for combate in combates:
        jueces_table_data.append([str(combate.id), _jueces_resumen(combate)])

    jueces_table = Table(jueces_table_data, colWidths=[2*cm, 24*cm], repeatRows=1)
    jueces_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(jueces_table)

    # ── Detalle de puntos en PDF ──
    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph("Detalle de Puntos por Juez", title_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#DDDDDD")))
    story.append(Spacer(1, 0.5 * cm))

    det_col_widths = [1.3*cm, 1.2*cm, 3*cm, 4.2*cm, 2.4*cm, 1.4*cm, 1.2*cm, 1*cm, 3*cm, 3*cm, 2*cm]
    det_table_data = [["Comb ID", "Rol", "Nombre", "Correo", "Asign.", "Acceso", "Color", "Pts", "Accion", "Momento", "Tipo"]]
    
    det_style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]

    det_row_idx = 1
    for combate in combates:
        historial = combate.historial_completo or []
        for entrada in historial:
            juez_meta = _juez_meta_para_evento(combate, entrada)
            tipo = ""
            if entrada.get("esEspecial"):   tipo = "Especial"
            elif entrada.get("esKyongGo"): tipo = "KyongGo"
            elif entrada.get("esGamJeum"): tipo = "GamJeum"
            else:                           tipo = "Punto Normal"

            det_table_data.append([
                str(combate.id),
                str(juez_meta["rol"]),
                str(juez_meta["nombre"]),
                str(juez_meta["email"]),
                str(juez_meta["asignacion"]),
                str(juez_meta["acceso"]),
                str(entrada.get("color", "-")),
                str(entrada.get("pts", 0)),
                str(entrada.get("nombre", "-")),
                _format_momento_evento(entrada),
                tipo,
            ])
            
            # Colores de fila alternos y colores para Hong/Chung
            bg_color = WHITE if det_row_idx % 2 != 0 else GRAY_BG
            det_style_cmds.append(("BACKGROUND", (0, det_row_idx), (-1, det_row_idx), bg_color))
            
            if entrada.get("color") == "hong":
                det_style_cmds.append(("BACKGROUND", (6, det_row_idx), (6, det_row_idx), HONG_BG))
            elif entrada.get("color") == "chung":
                det_style_cmds.append(("BACKGROUND", (6, det_row_idx), (6, det_row_idx), CHUNG_BG))
                
            det_row_idx += 1

    if len(det_table_data) > 1:
        t_det = Table(det_table_data, colWidths=det_col_widths, repeatRows=1)
        t_det.setStyle(TableStyle(det_style_cmds))
        story.append(t_det)

    doc.build(story)
    output.seek(0)

    filename = f"dinamyt_combates_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return send_file(
        output,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )
