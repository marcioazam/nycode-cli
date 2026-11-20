# Regras do agendador

1. Uma série guarda o horário de parede local (data e hora ingênuas) e o nome de um fuso IANA; os instantes UTC são sempre derivados. Fuso desconhecido → `ValueError`; início com fuso embutido → `ValueError`.
2. A ocorrência `n` (a partir de 0) acontece na data local `data_inicial + n × every_days`, no mesmo horário de parede local, qualquer que seja o horário de verão naquele dia. Uma reunião das 09:00 continua às 09:00 locais antes e depois da mudança de horário.
3. Horário inexistente (salto da primavera, ex.: 02:30 no dia em que 02:00 vira 03:00) é adiado pelo tamanho do salto: 02:30 passa a 03:30 local.
4. Horário ambíguo (hora repetida no outono) usa a primeira ocorrência, a anterior à mudança.
5. A duração é tempo decorrido: `fim = início_utc + duration_min` minutos. Nunca se faz aritmética em relógio de parede para o fim.
6. Cada ocorrência é normalizada de forma independente a partir da sua data local; o resultado de uma ocorrência nunca é usado para calcular a seguinte.
7. A janela de ocorrências é semiaberta em UTC: `início <= início_utc < fim`.
8. `count` limita o número de ocorrências; `until` é uma data local inclusiva (a data local da ocorrência `n` não pode passar de `until`); valem os dois limites ao mesmo tempo.
9. A semana do relatório vai da segunda 00:00 local de quem visualiza até a segunda seguinte 00:00 local, no fuso dele (uma semana pode ter 167 ou 169 horas). A data de início deve ser uma segunda-feira, senão `ValueError`.
10. Cada ocorrência pertence ao dia local, no fuso de quem visualiza, do seu início.
11. Dentro de um dia, as entradas ficam ordenadas por `(início_utc, id da série)`.
12. O total do dia soma o tempo decorrido das entradas, em minutos.
13. Duas ocorrências entram em conflito quando seus intervalos semiabertos em UTC se sobrepõem; intervalos que apenas se tocam não conflitam. Ambas são marcadas.
14. O texto do relatório mostra, por dia, `Dia AAAA-MM-DD total=Nm` e, por entrada, o horário local de quem visualiza, o título, a duração e um espaço seguido de `!` quando há conflito.
15. Ids de série duplicados → `ValueError`; `every_days`, `duration_min` e `count` devem ser positivos.
16. Quem visualiza em outro fuso vê o mesmo instante convertido: a mesma ocorrência pode cair em outro dia local.
