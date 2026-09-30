-- Fix: mobility data misattributed to Dom Fritton / Sam Highfill (see chat 2026-09-22).
-- Root cause: blank Name/Gmail header cells on copied assessment templates caused
-- get_or_create_athlete() to match ~50 other athletes' files to these two identities
-- via the fuzzy/email lookup. Case-only source_file duplicates were already cleaned up
-- separately. This script:
--   1) Reassigns each resolved row to its correct athlete (session_date left as recorded --
--      NOT set to today; ~33 of these still carry 2026-06-08, which looks like the date
--      the files were bulk-copied into the cache, not necessarily each athlete's true
--      intake date -- no better source exists for those, so it is left as-is rather than
--      guessed at.)
--   2) Deletes redundant copies of the same file that landed on both Dom and Sam, or where
--      the correct athlete already had this exact session recorded separately.
-- ~20 additional rows could not be confidently matched (new/ambiguous athletes) and are
-- intentionally left untouched pending manual review.
BEGIN;

UPDATE public.f_mobility SET athlete_uuid = 'a6d3daae-9557-40e9-8f48-bad1101e5b15' WHERE id = 187; -- Gavin Meagher
UPDATE public.f_mobility SET athlete_uuid = '76dbc44a-55a1-47d2-87fb-22e802bc463e' WHERE id = 174; -- Ben Baker
UPDATE public.f_mobility SET athlete_uuid = '895b23a2-88a2-4b96-825a-a54c88cc1a7f' WHERE id = 255; -- Oliver Swartz
UPDATE public.f_mobility SET athlete_uuid = '613b2616-1957-428e-b73a-0eabfeffc3ee' WHERE id = 192; -- Eli James
UPDATE public.f_mobility SET athlete_uuid = 'b5d408da-c4ce-49d4-ac5a-bad9f304974e' WHERE id = 188; -- Will Saxenmeyer
UPDATE public.f_mobility SET athlete_uuid = 'c8df3248-f36d-4165-a97e-8708cfa8d27c' WHERE id = 226; -- Cody Yarbrough
UPDATE public.f_mobility SET athlete_uuid = '7c5cdc7c-a501-4e63-b1af-9e1283cb75ed' WHERE id = 112; -- Max Williams
UPDATE public.f_mobility SET athlete_uuid = '49bd03a1-54ba-403f-8cae-3795b00469e9' WHERE id = 257; -- Carter Duty
UPDATE public.f_mobility SET athlete_uuid = '6014dbbe-d26a-467d-9194-9b3c2235987b' WHERE id = 126; -- Ryan Weiss
UPDATE public.f_mobility SET athlete_uuid = '9d8242de-141f-42bc-8ea7-644b6d12dc59' WHERE id = 140; -- Caleb White
UPDATE public.f_mobility SET athlete_uuid = 'a75652e8-3b03-4de6-a641-99ace605a742' WHERE id = 231; -- Koen Karsa
UPDATE public.f_mobility SET athlete_uuid = 'a7e0daaf-e605-485c-8a9a-dfa35d8346d5' WHERE id = 206; -- Jaxon Lucas
UPDATE public.f_mobility SET athlete_uuid = 'a898e988-0d22-425d-a221-39a3474385a8' WHERE id = 208; -- Austin Fletcher
UPDATE public.f_mobility SET athlete_uuid = '994bcd12-9f1b-4b22-8ef1-eac759994011' WHERE id = 179; -- Dylan Stacks
UPDATE public.f_mobility SET athlete_uuid = '3896b860-c6c9-4f8f-a58a-24b7573bd1c5' WHERE id = 219; -- Isaac James
UPDATE public.f_mobility SET athlete_uuid = '93575255-90ea-4f83-a9e9-d8b3e49deec7' WHERE id = 110; -- Simon Brutskiy
UPDATE public.f_mobility SET athlete_uuid = '905d5948-df5c-4064-bad1-64d664a1cded' WHERE id = 265; -- Rehaan Subzwari
UPDATE public.f_mobility SET athlete_uuid = 'b3a9f29e-0c2b-4bab-9fcf-2931b457367f' WHERE id = 115; -- Myles Ferrier
UPDATE public.f_mobility SET athlete_uuid = '2d307533-812c-48a4-be56-738fc9e7b601' WHERE id = 139; -- Bailey Berg
UPDATE public.f_mobility SET athlete_uuid = 'b0418652-f6c6-49c6-86d4-a0a9dfd86253' WHERE id = 167; -- Ryan Chasse
UPDATE public.f_mobility SET athlete_uuid = 'dbc63fcd-ed5b-4bf1-98e5-79f29c097126' WHERE id = 228; -- Charlie Pfeiffer
UPDATE public.f_mobility SET athlete_uuid = '94639fe6-d347-45f3-8ad6-91c95f6a77b0' WHERE id = 269; -- Davis Duty
UPDATE public.f_mobility SET athlete_uuid = 'c6466678-0baf-4aed-a919-d2d55a46579f' WHERE id = 261; -- Steven Locus
UPDATE public.f_mobility SET athlete_uuid = '4ed8b466-e04e-4f2e-89b4-9762a6753806' WHERE id = 141; -- Andres Colin
UPDATE public.f_mobility SET athlete_uuid = '6067603f-7737-4d83-af1f-6bdd3da357df' WHERE id = 214; -- Gideon Watkins
UPDATE public.f_mobility SET athlete_uuid = '5d3c22cc-ae96-44d8-9195-6eba5ef7d710' WHERE id = 225; -- Liam Wilson
UPDATE public.f_mobility SET athlete_uuid = 'ba24bc43-20c7-4d05-a029-3ff44d413728' WHERE id = 138; -- Miggy Delgado
UPDATE public.f_mobility SET athlete_uuid = '69aa824c-c523-4175-bd38-129577935a53' WHERE id = 212; -- Chandler Seagle
UPDATE public.f_mobility SET athlete_uuid = 'f2efad3e-2e70-4a8e-87f2-7d3acd3204ca' WHERE id = 199; -- Charlie Watkins
UPDATE public.f_mobility SET athlete_uuid = '051c9b95-906c-42f0-93b4-9b73414630dd' WHERE id = 243; -- Victor Vargas
UPDATE public.f_mobility SET athlete_uuid = 'e45da140-72c1-4f4e-b98a-077b6d811a8d' WHERE id = 184; -- Malhar Shelke
UPDATE public.f_mobility SET athlete_uuid = '50518f38-fdd6-42af-af82-1df30c9151cd' WHERE id = 116; -- Victor Nicholson
UPDATE public.f_mobility SET athlete_uuid = '333b7bc8-e73b-4a98-bba7-18296ba5bf25' WHERE id = 152; -- Cole Davidson
UPDATE public.f_mobility SET athlete_uuid = '4a4a2eb2-3847-4558-b725-02bcdeaea09c' WHERE id = 111; -- Carlos Lugos
UPDATE public.f_mobility SET athlete_uuid = '6223329c-9a4d-4bf3-9dd7-3c1943433d90' WHERE id = 177; -- Chris Teagle
UPDATE public.f_mobility SET athlete_uuid = '60b6be57-fa6d-498e-ae19-c3f62e8c1106' WHERE id = 150; -- Zach Vennaro
UPDATE public.f_mobility SET athlete_uuid = '748aa80b-2aa1-4ec4-ae78-6b601a292974' WHERE id = 492; -- Blake Letellier
UPDATE public.f_mobility SET athlete_uuid = '635909dc-1f3e-4c26-85fb-4c262868d419' WHERE id = 485; -- Reid Coleman
UPDATE public.f_mobility SET athlete_uuid = 'e9fc57b7-4c35-4fc2-ae31-49de20d481ea' WHERE id = 491; -- Simon Martone
UPDATE public.f_mobility SET athlete_uuid = '70cc9607-1b17-457a-914d-570c95a4998c' WHERE id = 496; -- Dane Purdy
UPDATE public.f_mobility SET athlete_uuid = 'e0cda8bf-d3f1-4dd3-9102-b5210bdd26b9' WHERE id = 487; -- Mason Eller
UPDATE public.f_mobility SET athlete_uuid = '742e68fb-a55f-43eb-a25e-f4dd01d0ea0d' WHERE id = 506; -- Chris Balgowan
UPDATE public.f_mobility SET athlete_uuid = 'b4b655c5-1363-4689-ae83-16888758aece' WHERE id = 573; -- Anthony Zezza
UPDATE public.f_mobility SET athlete_uuid = 'f25aeddc-6164-419e-9950-dfffb63337d8' WHERE id = 546; -- Benjamin Geurink
UPDATE public.f_mobility SET athlete_uuid = 'c3f1d3b6-5e09-4eae-85c2-21e67b6fdc28' WHERE id = 554; -- Jackson Money
UPDATE public.f_mobility SET athlete_uuid = 'dbe231fb-c6ed-46db-8c00-840ea82f327c' WHERE id = 559; -- Willy Harris
UPDATE public.f_mobility SET athlete_uuid = '62e2182a-b3c8-4fd9-9c85-c0b668cddd27' WHERE id = 553; -- Kaden Durnin
UPDATE public.f_mobility SET athlete_uuid = '3f3a8cf1-8d88-4b09-a701-e8bd2ff8c7c7' WHERE id = 556; -- Jett Music
UPDATE public.f_mobility SET athlete_uuid = '9d2c78a8-5aad-4838-b190-59abe5e37317' WHERE id = 560; -- Conner Berry
UPDATE public.f_mobility SET athlete_uuid = '6e385243-2eb3-4e93-ad9f-ea1db80563c8' WHERE id = 575; -- Braxton Shaffer
UPDATE public.f_mobility SET athlete_uuid = '28696c03-9200-4434-83da-26883e159877' WHERE id = 583; -- Beckett Howie
UPDATE public.f_mobility SET athlete_uuid = 'ac5e8fb4-cdf7-4f60-812d-51899a5d83f5' WHERE id = 565; -- Finn Del Bonta-smith
UPDATE public.f_mobility SET athlete_uuid = 'f0b2336a-ee96-449c-8ff6-e9502bbe9601' WHERE id = 569; -- Will Stephenson
UPDATE public.f_mobility SET athlete_uuid = '1de64f31-8655-401f-a047-daa67373a10a' WHERE id = 551; -- Brody Cox

DELETE FROM public.f_mobility WHERE id IN (109, 203, 235, 266, 284, 285, 286, 291, 295, 301, 305, 307, 313, 314, 325, 331, 333, 337, 341, 342, 346, 348, 351, 353, 355, 356, 365, 366, 368, 369, 371, 379, 381, 382, 387, 389, 400, 408, 413, 414, 415, 417, 419, 422, 424, 437, 442, 447, 449, 451, 452, 453, 457, 464, 465, 475);

SELECT update_athlete_data_flags();

COMMIT;
