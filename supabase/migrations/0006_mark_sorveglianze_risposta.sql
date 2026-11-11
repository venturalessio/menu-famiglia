-- Radar delle risposte: nuovo tipo di sorveglianza "risposta" (Gmail)
alter table public.mark_sorveglianze drop constraint if exists mark_sorveglianze_tipo_check;
alter table public.mark_sorveglianze add constraint mark_sorveglianze_tipo_check check (tipo in ('sito', 'pagina', 'dominio', 'risposta'));
