import { App, TFile, TAbstractFile, Notice } from "obsidian";
import { NutrientProvider } from "./FoodSuggestionCore";

interface NutrientData {
	calories?: number;
	fats?: number;
	saturated_fats?: number;
	protein?: number;
	carbs?: number;
	fiber?: number;
	sugar?: number;
	sodium?: number;
	serving_size?: number;
}

/**
 * Manages caching of nutrient files and their frontmatter data
 * Maintains efficient lookups for food names, filenames, and nutrition data
 *
 * This class provides a high-performance cache for nutrient data stored in markdown files
 * with frontmatter. It automatically watches for file changes and updates the cache accordingly.
 *
 * @example
 * ```typescript
 * // Initialize the cache for a specific directory
 * const cache = new NutrientCache(app, "nutrients");
 * cache.initialize();
 *
 * // Get nutrition data for a food item
 * const appleData = cache.getNutritionData("apple");
 * if (appleData) {
 *   console.log(`Calories: ${appleData.calories}`);
 * }
 *
 * // Get all available nutrient names for autocomplete
 * const allFoods = cache.getNutrientNames();
 * ```
 */
export default class NutrientCache implements NutrientProvider {
	private app: App;
	private nutrientDirectory: string;
	// When using a single-file database, this will be the file path (e.g. "nutrients.md")
	private singleFilePath: string | null = null;
	private isSingleFileMode: boolean = false;
	private nutrientDataCache: Map<string, { name: string; data: NutrientData }> = new Map(); // file path -> { name, data }
	private nameToPathMap: Map<string, string> = new Map(); // nutrient name -> file path
	private changeListeners: Set<() => void> = new Set();

	constructor(app: App, nutrientDirectory: string) {
		this.app = app;
		this.nutrientDirectory = nutrientDirectory;
	}

	onChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => {
			this.changeListeners.delete(listener);
		};
	}

	private notifyChange(): void {
		for (const listener of Array.from(this.changeListeners)) {
			try {
				listener();
			} catch (error) {
				console.error("Error notifying nutrient cache listener:", error);
			}
		}
	}

	/**
	 * Initializes the nutrient cache by scanning all markdown files in the nutrient directory
	 * Builds internal maps for efficient name and path lookups
	 *
	 * This method should be called once after creating the cache instance.
	 * It will clear any existing cache data and rebuild from current files.
	 */
	async initialize(): Promise<void> {
		this.nutrientDataCache.clear();
		this.nameToPathMap.clear();

		try {
			const candidate = this.nutrientDirectory;
			const abstractFile = this.app.vault.getAbstractFileByPath(candidate);

			if (abstractFile && (abstractFile as any).extension === "json" && (abstractFile as any).path) {
				// Single JSON file mode
				this.isSingleFileMode = true;
				this.singleFilePath = (abstractFile as any).path;
				await this.processSingleFile(abstractFile as TFile);
			} else if (abstractFile && (abstractFile as any).extension === "md" && (abstractFile as any).path) {
				// Support legacy markdown single-file (frontmatter)
				this.isSingleFileMode = true;
				this.singleFilePath = (abstractFile as any).path;
				await this.processSingleFile(abstractFile as TFile);
			} else {
				this.isSingleFileMode = false;
				this.singleFilePath = null;

				const allMarkdownFiles = this.app.vault.getMarkdownFiles();
				const nutrientFiles = allMarkdownFiles.filter(file => file.path.startsWith(this.nutrientDirectory + "/"));

				for (const file of nutrientFiles) {
					this.processNutrientFile(file);
				}
			}

			this.notifyChange();
		} catch (error) {
			console.error("Error initializing nutrient cache:", error);
		}
	}

	/**
	 * Removes a file's data from both cache maps
	 * Used by delete operations and when files lose valid nutrient names
	 */
	private removeFileFromCache(filePath: string): void {
		const cachedEntry = this.nutrientDataCache.get(filePath);
		if (cachedEntry) {
			this.nameToPathMap.delete(cachedEntry.name);
			this.nutrientDataCache.delete(filePath);
		}
	}

	/**
	 * Processes a single nutrient file and updates all relevant caches
	 * Handles cleanup of old mappings when files are modified or renamed
	 */
	private processNutrientFile(file: TFile): void {
		const nutrientName = this.extractNutrientName(file);
		const nutritionData = this.extractNutritionData(file);

		if (nutrientName) {
			// Check for duplicate nutrient names
			if (this.nameToPathMap.has(nutrientName) && this.nameToPathMap.get(nutrientName) !== file.path) {
				const conflictingPath = this.nameToPathMap.get(nutrientName);
				console.error(
					`Duplicate nutrient name "${nutrientName}" found in ${file.path}. It conflicts with ${conflictingPath}. The latest file will be used.`
				);
				new Notice(
					`Duplicate nutrient name "${nutrientName}" found in ${file.basename}. Check console for details.`,
					5000
				);
			}

			// Remove old name mapping if it exists and name changed
			const oldEntry = this.nutrientDataCache.get(file.path);
			if (oldEntry && oldEntry.name !== nutrientName) {
				this.nameToPathMap.delete(oldEntry.name);
			}

			// Update cache with new data
			this.nutrientDataCache.set(file.path, { name: nutrientName, data: nutritionData });
			this.nameToPathMap.set(nutrientName, file.path);
		} else {
			// If nutrient name is null/undefined, remove from cache
			this.removeFileFromCache(file.path);
		}
	}

	refresh(): void {
		void this.initialize();
	}

	isNutrientFile(file: TAbstractFile): file is TFile {
		if (!(file instanceof TFile)) return false;
		if (this.isSingleFileMode && this.singleFilePath) {
			return file.path === this.singleFilePath;
		}
		return file.extension === "md" && file.path.startsWith(this.nutrientDirectory + "/");
	}

	async updateCache(file: TFile, action: "create" | "delete" | "modify") {
		try {
			// If we're in single-file mode and the changed file is the DB file, reprocess whole DB
			if (this.isSingleFileMode) {
				if (file.path === this.singleFilePath) {
					if (action === "delete") {
						this.nutrientDataCache.clear();
						this.nameToPathMap.clear();
					} else {
						await this.processSingleFile(file);
					}
					this.notifyChange();
					return;
				}
				// If not the DB file, ignore unless it resides under the nutrientDirectory (fallback)
			}

			if (action === "delete") {
				this.removeFileFromCache(file.path);
				this.notifyChange();
				return;
			}

			this.processNutrientFile(file);
			this.notifyChange();
		} catch (error) {
			console.error("Error updating nutrient cache:", error);
			this.refresh();
		}
	}

	handleMetadataChange(file: TFile): void {
		if (this.isNutrientFile(file)) {
			this.processNutrientFile(file);
			this.notifyChange();
		}
	}

	/**
	 * Handles file rename events by cleaning up the old path and processing the new one
	 * More efficient than a full refresh for single file renames
	 */
	async handleRename(file: TFile, oldPath: string): Promise<void> {
		// Clean up old entry if it was a nutrient file
		if (this.isSingleFileMode) {
			// If the DB file was renamed, update singleFilePath and reprocess
			if (oldPath === this.singleFilePath) {
				// Try to detect new single-file path
				if (file.path.endsWith(".md") || file.path.endsWith(".json")) {
					this.singleFilePath = file.path;
					await this.processSingleFile(file);
				} else {
					// DB removed/renamed to non-md -> fall back to directory mode
					this.isSingleFileMode = false;
					this.singleFilePath = null;
					this.refresh();
				}
				this.notifyChange();
				return;
			}
		}

		// Directory-mode rename handling
		if (oldPath.startsWith(this.nutrientDirectory + "/") && oldPath.endsWith(".md")) {
			this.removeFileFromCache(oldPath);
		}

		if (this.isNutrientFile(file)) {
			this.processNutrientFile(file);
		}

		this.notifyChange();
	}

	/**
	 * Process a single-file nutrient DB. Expected format: frontmatter contains `foods` array
	 * where each item is an object with `name` and nutrient fields (calories, protein, etc.).
	 */
	private async processSingleFile(file: TFile): Promise<void> {
		this.nutrientDataCache.clear();
		this.nameToPathMap.clear();

		try {
			const content = await this.app.vault.cachedRead(file);

			// Try JSON first; if parsing fails, fall back to frontmatter 'foods'
			let parsed: any = null;
			try {
				parsed = JSON.parse(content);
			} catch (jsonErr) {
				parsed = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
			}

			const foods = Array.isArray(parsed?.foods) ? parsed.foods : Array.isArray(parsed) ? parsed : [];

			for (const item of foods) {
				if (!item || !item.name) continue;
				const nutrientName = String(item.name);
				const data: NutrientData = {};
				data.calories = this.parseNumber(item.calories);
				data.fats = this.parseNumber(item.fats);
				data.saturated_fats = this.parseNumber(item.saturated_fats ?? item.saturatedFats);
				data.protein = this.parseNumber(item.protein);
				data.carbs = this.parseNumber(item.carbs ?? item.carbohydrates);
				data.fiber = this.parseNumber(item.fiber);
				data.sugar = this.parseNumber(item.sugar);
				data.sodium = this.parseNumber(item.sodium);
				data.serving_size = this.parseNumber(item.serving_size ?? item.servingSize);

				const key = `${file.path}#${nutrientName}`;
				this.nutrientDataCache.set(key, { name: nutrientName, data });
				this.nameToPathMap.set(nutrientName, key);
			}
		} catch (error) {
			console.error("Error processing single-file nutrient DB:", error);
		}
	}

	private extractNutrientName(file: TFile): string | null {
		try {
			const parsedFrontMatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (parsedFrontMatter?.name) {
				return String(parsedFrontMatter.name);
			}
		} catch (error) {
			console.error("Error extracting nutrient name from file:", file.path, error);
		}
		return null;
	}

	private extractNutritionData(file: TFile): NutrientData {
		try {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!frontmatter) return {};

			const nutrientFields: { key: keyof NutrientData; aliases: string[] }[] = [
				{ key: "calories", aliases: ["calories"] },
				{ key: "fats", aliases: ["fats"] },
				{ key: "saturated_fats", aliases: ["saturated_fats", "saturatedFats"] },
				{ key: "protein", aliases: ["protein"] },
				{ key: "carbs", aliases: ["carbs", "carbohydrates"] },
				{ key: "fiber", aliases: ["fiber"] },
				{ key: "sugar", aliases: ["sugar"] },
				{ key: "sodium", aliases: ["sodium"] },
				{ key: "serving_size", aliases: ["serving_size", "servingSize"] },
			];

			const data: NutrientData = {};
			for (const field of nutrientFields) {
				// Find the first alias that exists in the frontmatter
				const value = field.aliases.map(alias => frontmatter[alias] as unknown).find(v => v !== undefined);
				if (value !== undefined) {
					data[field.key] = this.parseNumber(value);
				}
			}
			return data;
		} catch (error) {
			console.error(`Error extracting nutrition data from ${file.path}:`, error);
			return {};
		}
	}

	private parseNumber(value: unknown): number {
		if (typeof value === "number") return value;
		if (typeof value === "string") {
			const parsed = parseFloat(value);
			return isNaN(parsed) ? 0 : parsed;
		}
		return 0;
	}

	/**
	 * Gets all available nutrient names in alphabetical order
	 * Used for autocomplete and suggestion systems
	 *
	 * @returns Array of nutrient names sorted alphabetically
	 *
	 * @example
	 * ```typescript
	 * const names = cache.getNutrientNames();
	 * // Returns: ["apple", "banana", "chicken breast", ...]
	 * ```
	 */
	getNutrientNames(): string[] {
		return Array.from(this.nameToPathMap.keys()).sort();
	}

	/**
	 * Gets the filename (without .md extension) for a given nutrient name
	 * Used for creating wikilinks in suggestions
	 *
	 * @param nutrientName - The nutrient name to look up
	 * @returns The filename without extension, or null if not found
	 *
	 * @example
	 * ```typescript
	 * const filename = cache.getFileNameFromNutrientName("Chicken Breast");
	 * // Returns: "chicken-breast" (if that's the actual filename)
	 * ```
	 */
	getFileNameFromNutrientName(nutrientName: string): string | null {
		const mapped = this.nameToPathMap.get(nutrientName);
		if (!mapped) return null;

		// If single-file mode mapping (`path#Heading`), return `file#Heading` so suggestions produce [[file#Heading]]
		if (mapped.includes("#")) {
			const [filePath, heading] = mapped.split("#");
			const parts = filePath.split("/");
			const basename = parts[parts.length - 1].replace(".md", "");
			return `${basename}#${heading}`;
		}

		// Directory mode: return basename without extension
		const parts = mapped.split("/");
		return parts[parts.length - 1].replace(".md", "");
	}

	/**
	 * Gets nutrition data for a given filename
	 * Used by NutritionTotal to calculate totals from food entries
	 *
	 * @param filename - The filename (without .md extension) to look up
	 * @returns The nutrition data object, or null if not found
	 *
	 * @example
	 * ```typescript
	 * const data = cache.getNutritionData("apple");
	 * if (data) {
	 *   console.log(`Apple has ${data.calories} calories`);
	 * }
	 * ```
	 */
	getNutritionData(filename: string): NutrientData | null {
		// If filename contains a hash (file#heading), prefer lookup by heading
		try {
			if (filename.includes("#")) {
				const parts = filename.split("#");
				const heading = parts.slice(1).join("#");
				// Try to find an entry whose key ends with `#${heading}`
				for (const [key, entry] of this.nutrientDataCache) {
					if (key.endsWith(`#${heading}`)) return entry.data;
				}
			}

			// First try: direct name lookup (supports single-file name mappings)
			const mapped = this.nameToPathMap.get(filename);
			if (mapped) {
				const entry = this.nutrientDataCache.get(mapped);
				if (entry) return entry.data;
			}

			// Second try: basename match for directory-mode files
			for (const [path, entry] of this.nutrientDataCache) {
				const basename = path.split("/").pop()?.replace(".md", "");
				if (basename === filename) {
					return entry.data;
				}
			}

			// Third try: case-insensitive name match
			const lower = filename.toLowerCase();
			for (const [key, entry] of this.nutrientDataCache) {
				if (entry.name.toLowerCase() === lower) return entry.data;
			}
		} catch (error) {
			console.error("Error in getNutritionData lookup:", error);
		}

		return null;
	}

	updateNutrientDirectory(newDirectory: string): void {
		if (this.nutrientDirectory !== newDirectory) {
			this.nutrientDirectory = newDirectory;
			// Re-initialize cache to reflect the new directory
			void this.initialize();
		}
	}
}
