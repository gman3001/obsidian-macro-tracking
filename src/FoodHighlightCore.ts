import { createNutritionValueRegex, getUnitMultiplier } from "./constants";

export interface HighlightRange {
	start: number;
	end: number;
	type: "nutrition" | "amount";
}

export interface CalorieAnnotation {
	position: number;
	text: string;
}

export interface CalorieProvider {
	getCaloriesForFood(fileName: string): number | null;
	getServingSize(fileName: string): number | null;
}

export interface HighlightOptions {
	// Legacy fields (may be empty now)
	escapedFoodTag?: string;
	escapedWorkoutTag?: string;
	foodTag?: string;
	workoutTag?: string;
}

/**
 * Extracts lines that fall under a specific markdown heading (e.g., ## Food Log)
 */
export function extractLinesUnderHeading(text: string, headingText: string): Array<{ line: string; offset: number }> {
	const lines = text.split("\n");
	const result: Array<{ line: string; offset: number }> = [];
	let inSection = false;
	let offset = 0;

	for (const line of lines) {
		const headingMatch = line.match(/^(#{1,6})\s*(.*)$/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			const heading = headingMatch[2].trim();
			if (level === 2 && heading.toLowerCase() === headingText.toLowerCase()) {
				inSection = true;
				offset += line.length + 1;
				continue;
			}
			if (inSection && level <= 2) {
				break; // Exit section on same/higher level heading
			}
		}

		if (inSection) {
			result.push({ line, offset });
		}
		offset += line.length + 1;
	}

	return result;
}

/**
 * Extracts highlight ranges for linked food entries and inline nutrition values
 * Now operates on lines under ## Food Log heading without requiring #food tag
 */
export function extractFoodHighlightRanges(
	text: string,
	lineStart: number,
	_options: HighlightOptions
): HighlightRange[] {
	const ranges: HighlightRange[] = [];

	// Match linked food: [[Food Name]] 100g
	const linkedRegex = /\[\[([^\]]+)\]\]\s+(\d+(?:\.\d+)?)(kg|lb|cups?|tbsp|tsp|ml|oz|g|l|pcs?)/gi;
	const inlineRegex = /(-?\d+(?:\.\d+)?)\s*(kcal|fat|satfat|prot|carbs|sugar|fiber|sodium)/gi;

	let linkedMatch;
	while ((linkedMatch = linkedRegex.exec(text)) !== null) {
		const amountStart = lineStart + linkedMatch.index + linkedMatch[0].indexOf(linkedMatch[2]);
		const amountEnd = amountStart + linkedMatch[2].length + linkedMatch[3].length + 1;
		ranges.push({ start: amountStart, end: amountEnd, type: "amount" });
	}

	let inlineMatch;
	while ((inlineMatch = inlineRegex.exec(text)) !== null) {
		const valueStart = lineStart + inlineMatch.index;
		const valueEnd = valueStart + inlineMatch[0].length;
		ranges.push({ start: valueStart, end: valueEnd, type: "nutrition" });
	}

	return ranges;
}

/**
 * Processes multiple lines and extracts all highlight ranges
 */
export function extractMultilineHighlightRanges(
	text: string,
	startOffset: number,
	options: HighlightOptions
): HighlightRange[] {
	const ranges: HighlightRange[] = [];
	const linesByOffset = extractLinesUnderHeading(text, "Food Log");

	for (const { line, offset } of linesByOffset) {
		const lineRanges = extractFoodHighlightRanges(line, startOffset + offset, options);
		ranges.push(...lineRanges);
	}

	return ranges;
}

/**
 * Extracts inline calorie annotations for linked food entries
 * Looks only under ## Food Log heading, no tag requirement
 */
export function extractInlineCalorieAnnotations(
	text: string,
	startOffset: number,
	_options: HighlightOptions,
	calorieProvider: CalorieProvider
): CalorieAnnotation[] {
	const annotations: CalorieAnnotation[] = [];

	const linesByOffset = extractLinesUnderHeading(text, "Food Log");

	for (const { line, offset } of linesByOffset) {
		const linkedFoodRegex = /\[\[([^\]]+)\]\]\s+(\d+(?:\.\d+)?)(kg|lb|cups?|tbsp|tsp|ml|oz|g|l|pcs?)/gi;

		let match;
		while ((match = linkedFoodRegex.exec(line)) !== null) {
			const rawFileName = match[1];
			const amountString = match[2];
			const unit = match[3];

			const amount = parseFloat(amountString);
			if (!isFinite(amount) || amount <= 0) {
				continue;
			}

			// Extract base filename (handle #anchors and paths)
			const normalizedFileName = rawFileName.split("|")[0].split("#")[0].split("/").pop()?.trim();
			if (!normalizedFileName) {
				continue;
			}

			const caloriesPerHundred = calorieProvider.getCaloriesForFood(normalizedFileName);
			if (caloriesPerHundred === null || caloriesPerHundred === undefined || !isFinite(caloriesPerHundred)) {
				continue;
			}

			const servingSize = calorieProvider.getServingSize(normalizedFileName);
			const multiplier = getUnitMultiplier(amount, unit, servingSize ?? undefined);
			const calculatedCalories = multiplier * caloriesPerHundred;

			if (!Number.isFinite(calculatedCalories) || calculatedCalories < 0) {
				continue;
			}

			const formattedCalories = Math.round(calculatedCalories);
			if (!Number.isFinite(formattedCalories) || formattedCalories < 0) {
				continue;
			}

			const lineEnd = startOffset + offset + line.length;
			annotations.push({
				position: lineEnd,
				text: `${formattedCalories}kcal`,
			});
		}
	}

	return annotations;
}
