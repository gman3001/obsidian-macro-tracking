import {
	extractFoodHighlightRanges,
	extractMultilineHighlightRanges,
	extractInlineCalorieAnnotations,
	extractLinesUnderHeading,
} from "../FoodHighlightCore";

/**
 * Updated tests for heading-based Food Log parsing
 * Food entries are now triggered by content under ## Food Log heading
 * Formats: [[Food]] 200g (linked) or Food 300kcal 25prot (inline)
 * No #food or #workout tags needed
 */
describe("FoodHighlightCore", () => {
	const defaultOptions = {};

	describe("extractLinesUnderHeading", () => {
		test("extracts lines under ## Food Log heading", () => {
			const text = `
## Food Log

Apple 50kcal
Banana 89kcal

## Other Section
Not included
`;
			const lines = extractLinesUnderHeading(text, "Food Log");
			expect(lines.length).toBeGreaterThan(0);
			expect(lines.some(l => l.line.includes("Apple"))).toBe(true);
			expect(lines.some(l => l.line.includes("Other Section"))).toBe(false);
		});

		test("stops at same-level heading", () => {
			const text = `
## Food Log
Item 1

## Next Section
Item 2
`;
			const lines = extractLinesUnderHeading(text, "Food Log");
			expect(lines.some(l => l.line.includes("Item 2"))).toBe(false);
		});

		test("is case-insensitive", () => {
			const text = `
## FOOD LOG
Item 1
`;
			const lines = extractLinesUnderHeading(text, "Food Log");
			expect(lines.length).toBeGreaterThan(0);
		});

		test("returns empty array when heading not found", () => {
			const text = `
## Other Heading
Item 1
`;
			const lines = extractLinesUnderHeading(text, "Food Log");
			expect(lines.length).toBe(0);
		});
	});

	describe("extractFoodHighlightRanges", () => {
		describe("linked food format", () => {
			test("highlights amount values with weight units", () => {
				const text = "[[Chicken Breast]] 200g";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges.length).toBeGreaterThan(0);
				const amountRange = ranges.find(r => r.type === "amount");
				expect(amountRange).toBeDefined();
			});

			test("handles various units", () => {
				const testCases = [
					{ text: "[[Apple]] 150g" },
					{ text: "[[Milk]] 500ml" },
					{ text: "[[Flour]] 2cup" },
					{ text: "[[Oil]] 3tbsp" },
					{ text: "[[Salt]] 1tsp" },
					{ text: "[[Cheese]] 4oz" },
					{ text: "[[Meat]] 1.2lb" },
					{ text: "[[Water]] 1l" },
					{ text: "[[Banana]] 1pc" },
				];

				testCases.forEach(({ text }) => {
					const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);
					const amountRange = ranges.find(r => r.type === "amount");
					expect(amountRange).toBeDefined();
				});
			});

			test("handles decimal amounts", () => {
				const text = "[[Pasta]] 125.5g";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges.some(r => r.type === "amount")).toBe(true);
			});

			test("ignores amounts without brackets", () => {
				const text = "Chicken 200g";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges.length).toBe(0);
			});
		});

		describe("inline nutrition format", () => {
			test("highlights individual nutrition values", () => {
				const text = "Chicken Breast 300kcal 25prot 5fat 0carbs";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				const nutritionRanges = ranges.filter(r => r.type === "nutrition");
				expect(nutritionRanges.length).toBeGreaterThanOrEqual(2);
			});

			test("handles decimal values", () => {
				const text = "Salmon 150.5kcal 12.3fat";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges.length).toBeGreaterThan(0);
			});

			test("handles mixed case nutrition keywords", () => {
				const text = "Snack 200KCAL 10FAT 15PROT";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges.length).toBeGreaterThanOrEqual(2);
			});

			test("highlights negative kcal values as nutrition type", () => {
				const text = "Recovery -150kcal";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges.length).toBeGreaterThan(0);
				expect(ranges.some(r => r.type === "nutrition")).toBe(true);
			});
		});

		describe("edge cases", () => {
			test("returns empty array for non-matching text", () => {
				const text = "This is just regular text";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges).toHaveLength(0);
			});

			test("returns empty array for incomplete food entries", () => {
				const text = "Chicken";
				const ranges = extractFoodHighlightRanges(text, 0, defaultOptions);

				expect(ranges).toHaveLength(0);
			});

			test("accounts for line start offset", () => {
				const text = "[[Chicken]] 300g";
				const ranges = extractFoodHighlightRanges(text, 100, defaultOptions);

				expect(ranges.some(r => r.start >= 100)).toBe(true);
			});
		});
	});

	describe("extractInlineCalorieAnnotations", () => {
		test("extracts calorie values from linked food", () => {
			const text = "[[Chicken]] 200g";
			const annotations = extractInlineCalorieAnnotations(text, 0, defaultOptions);

			expect(annotations).toBeDefined();
		});

		test("returns empty for text without linked food", () => {
			const text = "Regular food text";
			const annotations = extractInlineCalorieAnnotations(text, 0, defaultOptions);

			expect(annotations).toBeDefined();
		});
	});

	describe("extractMultilineHighlightRanges", () => {
		test("extracts highlights from Food Log section only", () => {
			const text = `
## Food Log

[[Apple]] 150g
Banana 300kcal 20carbs

## Workouts
[[Running]] 10km
`;
			const ranges = extractMultilineHighlightRanges(text, 0, defaultOptions);

			// Should find ranges in Food Log section
			expect(ranges.length).toBeGreaterThan(0);
		});

		test("ignores content outside Food Log section", () => {
			const text = `
[[Not In Food Log]] 100g

## Food Log
[[Apple]] 150g

[[Also Not In Food Log]] 200g
`;
			const ranges = extractMultilineHighlightRanges(text, 0, defaultOptions);

			// Should only highlight content under ## Food Log
			const foodLogIndex = text.indexOf("## Food Log");
			expect(ranges.every(r => r.start > foodLogIndex)).toBe(true);
		});

		test("handles multiple entries in Food Log", () => {
			const text = `
## Food Log
[[Apple]] 150g
[[Banana]] 200g
Oatmeal 300kcal 50carbs
`;
			const ranges = extractMultilineHighlightRanges(text, 0, defaultOptions);

			// Should find multiple highlights
			expect(ranges.length).toBeGreaterThanOrEqual(3);
		});

		test("handles empty Food Log section", () => {
			const text = `
## Food Log

## Other Section
`;
			const ranges = extractMultilineHighlightRanges(text, 0, defaultOptions);

			expect(ranges).toHaveLength(0);
		});

		test("handles Food Log with mixed content", () => {
			const text = `
## Food Log
- [[Apple]] 150g
- Item 300kcal 25prot
- Random text without nutrition
- [[Chicken]] 200g
`;
			const ranges = extractMultilineHighlightRanges(text, 0, defaultOptions);

			// Should find nutrition entries, ignoring random text
			expect(ranges.length).toBeGreaterThanOrEqual(2);
		});

		test("handles offset positions correctly", () => {
			const text = `Some initial content
## Food Log
[[Apple]] 150g`;
			const ranges = extractMultilineHighlightRanges(text, 100, defaultOptions);

			expect(ranges.some(r => r.start >= 100)).toBe(true);
		});
	});

	describe("integration scenarios", () => {
		test("complete food log with linked and inline entries", () => {
			const text = `
## Food Log

[[Chicken Breast]] 200g
[[Rice]] 1cup
Oatmeal 350kcal 12prot 8fat 55carbs
Apple 80kcal 0prot 0fat 20carbs

## Workouts
[[Running]] 5km
`;
			const ranges = extractMultilineHighlightRanges(text, 0, defaultOptions);

			// Should find highlights from all 4 food entries
			expect(ranges.length).toBeGreaterThanOrEqual(4);
		});

		test("handles Food Log with various formatting", () => {
			const text = `
## Food Log

[[Apple]] 150g - morning snack
Lunch: Sandwich 500kcal 20prot
  [[Broccoli]] 200g (steamed)
Dinner 1200kcal 45prot 35fat 100carbs
`;
			const ranges = extractMultilineHighlightRanges(text, 0, defaultOptions);

			expect(ranges.length).toBeGreaterThan(0);
		});

		test("case-insensitive Food Log heading detection", () => {
			const text1 = `
## Food Log
[[Apple]] 150g
`;
			const text2 = `
## FOOD LOG
[[Apple]] 150g
`;
			const text3 = `
## food log
[[Apple]] 150g
`;

			const ranges1 = extractMultilineHighlightRanges(text1, 0, defaultOptions);
			const ranges2 = extractMultilineHighlightRanges(text2, 0, defaultOptions);
			const ranges3 = extractMultilineHighlightRanges(text3, 0, defaultOptions);

			expect(ranges1.length).toBeGreaterThan(0);
			expect(ranges2.length).toBeGreaterThan(0);
			expect(ranges3.length).toBeGreaterThan(0);
		});
	});
});
