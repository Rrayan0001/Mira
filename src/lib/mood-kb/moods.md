# Mood signals — GirlfriendChatbot KB

> Each section is one mood. Used by `retrieve()` for mood classification.
> Keep sections short; the build script chunks on `## ` headings.

## happy
Signals:
- bright, upbeat words like "amazing", "yay", "so good"
- exclamation marks, laughter ("haha", "lol"), playful teasing
- shares good news, wins, plans, gratitude
- high energy, fast-flowing replies, emojis described in words
Example phrases:
- "today was amazing, i got the news i wanted"
- "haha that made my whole day, you always know"
- "i'm so excited for this weekend with you"
- "everything just feels light and good right now"
- "i can't stop smiling thinking about today"
Don't mistake for: neutral (happy has sparkle and energy, neutral is calm small-talk)

## sad
Signals:
- low, heavy words like "down", "cry", "hurt", "miss"
- mentions of loss, disappointment, feeling blue or empty
- slower replies, sighs written out, "i don't know"
- seeks comfort, reassurance, gentle presence
Example phrases:
- "i just feel down and i don't know why"
- "today left me feeling empty inside"
- "i could really use a hug right now"
- "everything feels heavy and grey today"
- "i miss how things used to feel"
Don't mistake for: lonely (sad wants comfort for pain, lonely wants company for absence)

## angry
Signals:
- sharp, heated words like "furious", "annoying", "unfair", "fed up"
- complaints about people, work, being ignored or disrespected
- short bursts, caps for emphasis, "ugh", "seriously?"
- blames someone or something, wants to be heard
Example phrases:
- "work is driving me crazy today, nobody listens"
- "i'm so fed up with being treated like this"
- "ugh, he completely ignored what i said again"
- "this is so unfair, i'm furious right now"
- "seriously? they cancelled on me last minute again"
Don't mistake for: anxious (angry pushes outward with blame, anxious loops inward with worry)

## anxious
Signals:
- worry words like "nervous", "overthinking", "what if", "can't relax"
- racing thoughts, restlessness, trouble sleeping mentioned
- work pressure and deadlines piling up, feeling behind
- asks for reassurance, repeats concerns, seeks grounding
- future-focused fears about tomorrow, messages, events
Example phrases:
- "my mind won't stop racing about tomorrow"
- "i keep overthinking what i said to them"
- "the deadlines at work are driving me crazy with worry"
- "i feel restless and can't seem to relax"
- "my chest feels tight thinking about it all"
Don't mistake for: angry (anxious seeks calming and grounding, angry seeks venting)

## tired
Signals:
- short replies, low energy words
- mentions of exhaustion, sleep, long day
- words like "drained", "exhausted", "sleepy", "no energy"
- wants rest, quiet, early night, less talking
Example phrases:
- "i'm drained, today was endless"
- "i feel exhausted and just want to sleep"
- "long day, i have no energy left to talk"
- "my eyes are heavy, i'm running on empty"
- "i'm so tired i can barely think straight"
Don't mistake for: sad (tired wants rest, sad wants comfort)

## lonely
Signals:
- mentions of being alone, missing someone, quiet house
- words like "nobody", "miss you", "wish you were here"
- evening/night setting, scrolling, waiting for replies
- seeks warmth, company, gentle check-ins
Example phrases:
- "the house feels so quiet without anyone around"
- "i miss you, wish you were here tonight"
- "everyone seems busy and nobody texts back"
- "i feel alone even when i'm out with people"
- "nights like this make the loneliness louder"
Don't mistake for: sad (lonely wants closeness and presence, sad wants soothing)

## neutral
Signals:
- calm, even tone with no strong emotion words
- routine small-talk: day, weather, food, plans
- short factual answers, "okay", "fine", "not much"
- no urgency, no complaint, no sparkle, just present
Example phrases:
- "hey, today was pretty normal, nothing special"
- "just having lunch, what are you up to"
- "yeah i'm fine, just doing some chores"
- "not much going on, regular tuesday stuff"
- "it was okay, work was work as usual"
Don't mistake for: happy (neutral is steady and plain, happy lifts with warmth)
