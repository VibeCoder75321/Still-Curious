import type { ProducerOutput } from "../../lib/episode-v2/prompts/producer.ts";

// Authored commissioning examples, not model-generated research or verified scientific answers.
export const producerFixtures: { name: string; request: string; output: ProducerOutput }[] = [
  {
    name: "broad topic", request: "Trees",
    output: {
      title: "Water at the top of a tree",
      brief: {
        mainCuriosity: "How a very tall living thing gets water to its highest leaves", interpretation: "inferred",
        interpretationNote: "Trees is broad; water transport is one concrete five-minute entry point. No narrower preference was stated.",
        centralQuestion: "How does water reach the top of a tall tree?",
        listenerPromise: "Understand the proposed transport mechanism, the measurements behind it and one important limit.",
        startingKnowledge: "No specialist botany assumed", essentialFoundations: ["Where water enters and leaves a tree", "What a pressure difference means"],
        deeperFocus: "How evidence can distinguish accounts of upward water movement",
        exclusions: ["A survey of all tree biology", "The evolution of forests", "Detailed species comparisons"],
        secondaryQuestions: ["What could limit the height of water transport?"],
        premisesToCheck: ["Does one transport account apply across the trees discussed?"], atmosphere: "Composed, curious and concrete",
      },
      research: {
        questions: ["What pathway carries water to the upper leaves?", "Which measurements distinguish proposed sources of the driving force?", "What limits or failures matter in tall trees?"],
        evidenceRequirements: ["A primary measurement of water transport or pressure, with conditions and limits", "An authoritative explanation linking that measurement to the mechanism"],
        alternativesToExamine: ["Compare proposed roles for root pressure and processes associated with the leaves; establish where each matters"],
        storiesToSeek: ["A documented measurement or experiment that made an otherwise invisible process observable"],
        avoid: ["Treating the tree as if it uses an animal heart", "Extending one species or condition to every tree"],
        evidenceSufficiency: "Enough read material to explain one transport pathway, connect it to a discriminating observation and state an important limit.",
      },
      adaptation: {
        scopeDecision: "narrowed", scopeRationale: "One physical puzzle makes Trees manageable without pretending to survey the subject.",
        introductionPurpose: "Picture the highest leaf and pose the water-transport question with brief introductions.",
        discussionFocus: "Build the pressure idea, examine one measurement, then test the explanation against a limit.",
        endingAim: "Return to the highest leaf with a clearer mechanism and an honest boundary.",
      },
    },
  },
  {
    name: "narrow question", request: "Why do some fireflies flash together?",
    output: {
      title: "A shared rhythm in fireflies",
      brief: {
        mainCuriosity: "How individual flashes become a collective pattern", interpretation: "explicit",
        interpretationNote: "The request specifically asks about coordination; light production is background only.",
        centralQuestion: "Why do some fireflies flash together?",
        listenerPromise: "Distinguish a shared flashing pattern from evidence for the mechanism producing it.",
        startingKnowledge: "No insect biology or modelling assumed", essentialFoundations: ["What counts as flashing together", "Which species and setting the observation concerns"],
        deeperFocus: "Evidence that could distinguish responses between individuals from other explanations of the pattern",
        exclusions: ["A full account of bioluminescent chemistry", "A survey of all fireflies"],
        secondaryQuestions: ["What could a simple model predict that an observation could test?"],
        premisesToCheck: ["Which observations actually show synchrony, on which time scale?"], atmosphere: "Calm and intellectually engaged",
      },
      research: {
        questions: ["What synchronised behaviour has been measured, and in which species and conditions?", "What mechanisms have been proposed?", "Which experiment or observation discriminates between them?"],
        evidenceRequirements: ["Relevant primary observations and the actual material accessible to the researcher", "Methods or experimental evidence connecting an explanation to the behaviour", "Publication-status checks for a central study"],
        alternativesToExamine: ["Investigate interaction between individuals and possible shared external influences without assuming equal support"],
        storiesToSeek: ["A documented intervention or unexpected observation that tested an explanation"],
        avoid: ["Generalising one species to all fireflies", "Treating a successful simulation as proof of a biological mechanism", "Inventing a charming discovery scene"],
        evidenceSufficiency: "Support a limited account of the observed pattern, at least one test of its explanation and the main remaining uncertainty.",
      },
      adaptation: {
        scopeDecision: "preserved", scopeRationale: "The question is already focused; define a flash only as needed to discuss coordination.",
        introductionPurpose: "Introduce the shared-rhythm puzzle and reach the coordination question quickly.",
        discussionFocus: "Spend most of the discussion on observations, mechanism and a test rather than light chemistry.",
        endingAim: "Separate what is established about the pattern from what is still open about its explanation.",
      },
    },
  },
  {
    name: "questionable premise", request: "How do trees decide to help their friends?",
    output: {
      title: "What would count as help between trees?",
      brief: {
        mainCuriosity: "What evidence supports accounts of beneficial relationships between trees", interpretation: "inferred",
        interpretationNote: "I take help as a question about effects between trees, while keeping decide and friends as premises to examine.",
        centralQuestion: "What evidence would show that an interaction benefits another tree?",
        listenerPromise: "Tell an observed interaction apart from claims about benefit, intention and friendship.",
        startingKnowledge: "General interest; no plant ecology assumed", essentialFoundations: ["What a researcher means by an interaction", "How benefit could be measured"],
        deeperFocus: "Which observations would establish the claimed benefit and distinguish alternative causes",
        exclusions: ["A general tour of forest ecology", "A settled verdict before the evidence is read"],
        secondaryQuestions: ["What does the language of friendship add or hide?"],
        premisesToCheck: ["Whether benefit has been measured", "Whether intentional decision-making is supported or is a metaphor"], atmosphere: "Curious and careful without dismissing the listener",
      },
      research: {
        questions: ["Which specific interaction is being claimed?", "What was measured in the recipient, and compared with what?", "Which alternative explanations or later challenges affect the claimed benefit?"],
        evidenceRequirements: ["Read a relevant primary study and its controls rather than relying on a headline", "Find serious methodological criticism or follow-up where relevant"],
        alternativesToExamine: ["Separate measured benefit from incidental transfer or a shared environmental cause"],
        storiesToSeek: ["A documented experiment whose controls clarify what can actually be inferred"],
        avoid: ["Assuming friendship or intentional choice", "Rejecting the underlying scientific curiosity merely because the wording is anthropomorphic"],
        evidenceSufficiency: "One well-defined claimed interaction, its measured outcome, the main alternatives and enough limitations to avoid overclaiming.",
      },
      adaptation: {
        scopeDecision: "narrowed", scopeRationale: "One testable interaction can address the listener's interest while examining the language in the premise.",
        introductionPurpose: "Use the listener's intriguing wording to open a concrete question about evidence.",
        discussionFocus: "Define benefit, examine one test and ask what it can and cannot establish.",
        endingAim: "Clarify the distinction between an ecological effect and an intentional act without imposing a verdict beforehand.",
      },
    },
  },
];
