# Payloads reais dos eventos de hook

Capturados em 2026-11-11 por um `nycode -p --settings` com um hook que grava o stdin de cada evento (repositório
temporário, Sonnet 5.5). `../dispatch/test_dispatch.py` roda o dispatcher sobre eles, para não depender só de
payloads montados à mão. Recapturar quando o formato dos eventos da extensão hooks mudar.
