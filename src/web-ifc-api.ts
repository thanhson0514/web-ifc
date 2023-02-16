/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
    Handle,
    IfcLineObject,
    TypeInitialisers,
    FILE_SCHEMA,
    FILE_NAME, 
    FILE_DESCRIPTION,
    FromRawLineData,
    Constructors,
    InheritanceDef,
    InversePropertyDef,
    ToRawLineData,
    SchemaNames
} from "./ifc-schema";

let WebIFCWasm: any;

//@ts-ignore
if (typeof self !== 'undefined' && self.crossOriginIsolated) {
    try {
        WebIFCWasm = require("./web-ifc-mt");
    } catch (ex){
        WebIFCWasm = require("./web-ifc");
    }
}
else {
    WebIFCWasm = require("./web-ifc");
}
export * from "./ifc-schema";
import { Properties } from "./helpers/properties";
import { Log, LogLevel } from "./helpers/log";
export { LogLevel };


export const UNKNOWN = 0;
export const STRING = 1;
export const LABEL = 2;
export const ENUM = 3;
export const REAL = 4;
export const REF = 5;
export const EMPTY = 6;
export const SET_BEGIN = 7;
export const SET_END = 8;
export const LINE_END = 9;

/**
 * Settings for the IFCLoader
 * @property {boolean} COORDINATE_TO_ORIGIN - If true, the model will be translated to the origin.
 * @property {boolean} USE_FAST_BOOLS - Deprecated option, will be removed in next releases.
 * @property {number} CIRCLE_SEGMENTS_LOW - Number of segments for low quality circles.
 * @property {number} CIRCLE_SEGMENTS_MEDIUM - Number of segments for medium quality circles.
 * @property {number} CIRCLE_SEGMENTS_HIGH - Number of segments for high quality circles.
 * @property {number} BOOL_ABORT_THRESHOLD - Threshold for aborting boolean operations.
 * @property {number} MEMORY_LIMIT - Memory limit for the loader.
 * @property {number} TAPE_SIZE - Size of the tape for the loader.
 */
export interface LoaderSettings {
    COORDINATE_TO_ORIGIN?: boolean;
    USE_FAST_BOOLS?: boolean;
    CIRCLE_SEGMENTS_LOW?: number;
    CIRCLE_SEGMENTS_MEDIUM?: number;
    CIRCLE_SEGMENTS_HIGH?: number;
    BOOL_ABORT_THRESHOLD?: number;
    MEMORY_LIMIT?: number;
    TAPE_SIZE? : number;
}

export interface Vector<T> {
    get(index: number): T;
    size(): number;
}

export interface Color {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface RawLineData {
    ID: number;
    type: number;
    arguments: any[];
}

export interface PlacedGeometry {
    color: Color;
    geometryExpressID: number;
    flatTransformation: Array<number>;
}

export interface FlatMesh {
    geometries: Vector<PlacedGeometry>;
    expressID: number;
}

export interface LoaderError {
    type: string;
    message: string;
    expressID: number;
    ifcType: number;
}

export interface IfcGeometry {
    GetVertexData(): number;
    GetVertexDataSize(): number;
    GetIndexData(): number;
    GetIndexDataSize(): number;
}

export interface ifcType {
    typeID: number;
    typeName: string;
}

export interface NewIfcModel {
    schema: string;
    name?: string;
    description?: string[];
    authors?: string[];
    organizations?: string[];
    authorization?: string;
}

export function ms() {
    return new Date().getTime();
}

export type LocateFileHandlerFn = (path: string, prefix: string) => string;

export class IfcAPI {
    wasmModule: undefined | any = undefined;
    wasmPath: string = "";
    isWasmPathAbsolute = false;

    modelSchemaList: Array<number> = [];

    ifcGuidMap: Map<number, Map<string | number, string | number>> = new Map<number, Map<string | number, string | number>>();

    /**
     * Contains all the logic and methods regarding properties, psets, qsets, etc.
     */
    properties = new Properties(this);

    /**
     * Initializes the WASM module (WebIFCWasm), required before using any other functionality.
     *
     * @param customLocateFileHandler An optional locateFile function that let's
     * you override the path from which the wasm module is loaded.
     */
    async Init(customLocateFileHandler?: LocateFileHandlerFn) {
        if (WebIFCWasm) {
            let locateFileHandler: LocateFileHandlerFn = (path, prefix) => {
                // when the wasm module requests the wasm file, we redirect to include the user specified path
                if (path.endsWith(".wasm")) {
                    if (this.isWasmPathAbsolute) {
                        return this.wasmPath + path;
                    }

                    return prefix + this.wasmPath + path;
                }
                // otherwise use the default path
                return prefix + path;
            }

            //@ts-ignore
            this.wasmModule = await WebIFCWasm({ noInitialRun: true, locateFile: customLocateFileHandler || locateFileHandler });
        }
        else {
			Log.error(`Could not find wasm module at './web-ifc' from web-ifc-api.ts`);
        }
    }

     /**
     * Opens a set of models and returns model IDs 
     * @param dataSets Array of Buffers containing IFC data (bytes)
     * @param settings Settings for loading the model @see LoaderSettings
	 * @returns Array of model IDs
    */
    OpenModels(dataSets: Array<Uint8Array>, settings?: LoaderSettings): Array<number> {
        let s: LoaderSettings = {
            MEMORY_LIMIT :  3221225472,
            ...settings
        };
        s.MEMORY_LIMIT = s.MEMORY_LIMIT! / dataSets.length;
        let modelIDs:Array<number> = [];

        for (let dataSet of dataSets) modelIDs.push(this.OpenModel(dataSet,s));
        return modelIDs
    }


    /**
     * Opens a model and returns a modelID number
     * @param data Buffer containing IFC data (bytes)
     * @param settings Settings for loading the model @see LoaderSettings
	 * @returns ModelID
    */
    OpenModel(data: Uint8Array, settings?: LoaderSettings): number {
        let s: LoaderSettings = {
            COORDINATE_TO_ORIGIN: false,
            USE_FAST_BOOLS: true, //TODO: This needs to be fixed in the future to rely on elalish/manifold
            CIRCLE_SEGMENTS_LOW: 5,
            CIRCLE_SEGMENTS_MEDIUM: 8,
            CIRCLE_SEGMENTS_HIGH: 12,
            BOOL_ABORT_THRESHOLD: 10000,
            TAPE_SIZE: 67108864,
            MEMORY_LIMIT: 3221225472,
            ...settings
        };
        let result = this.wasmModule.OpenModel(s, (destPtr: number, offsetInSrc: number, destSize: number) => {
            let srcSize = Math.min(data.byteLength - offsetInSrc, destSize);
            let dest = this.wasmModule.HEAPU8.subarray(destPtr, destPtr + srcSize);
            let src = data.subarray(offsetInSrc, offsetInSrc + srcSize );
            dest.set(src);
            return srcSize;
        });
        this.modelSchemaList[result] = SchemaNames.indexOf(this.GetHeaderLine(result, FILE_SCHEMA).arguments[0][0].value);
        Log.info("Parsing Model using " + this.GetHeaderLine(result, FILE_SCHEMA).arguments[0][0].value + " Schema");
        return result;
    }

    /**
     * Fetches the ifc schema version of a given model
     * @param modelID Model ID
	 * @returns IFC Schema version
    */
    GetModelSchema(modelID: number) {
        return SchemaNames[this.modelSchemaList[modelID]];
    }

    /**
     * Creates a new model and returns a modelID number
     * @param schema ifc schema version
	 * @returns ModelID
    */
    CreateModel(model: NewIfcModel, settings?: LoaderSettings): number {
        let s: LoaderSettings = {
            COORDINATE_TO_ORIGIN: false,
            USE_FAST_BOOLS: true, //TODO: This needs to be fixed in the future to rely on elalish/manifold
            CIRCLE_SEGMENTS_LOW: 5,
            CIRCLE_SEGMENTS_MEDIUM: 8,
            CIRCLE_SEGMENTS_HIGH: 12,
            BOOL_ABORT_THRESHOLD: 10000,
            TAPE_SIZE: 67108864,
            MEMORY_LIMIT: 3221225472,
            ...settings
        };
        let result = this.wasmModule.CreateModel(s);
        this.modelSchemaList[result] = SchemaNames.indexOf(model.schema);
        const modelName = model.name || "web-ifc-model-"+result+".ifc";
        const timestamp = new Date().toISOString().slice(0,19);
        const description = model.description?.map((d) => ({type: STRING, value: d})) || [{type: STRING, value: 'ViewDefinition [CoordinationView]'}];
        const authors = model.authors?.map((a) => ({type: STRING, value: a})) || [null];
        const orgs = model.organizations?.map((o) => ({type: STRING, value: o})) || [null];
        const auth = model.authorization ? {type: STRING, value: model.authorization} : null;
        
        this.wasmModule.WriteHeaderLine(result,FILE_DESCRIPTION,[
            description, 
            {type: STRING, value: '2;1'}
        ]);
        this.wasmModule.WriteHeaderLine(result,FILE_NAME,[
            {type: STRING, value: modelName},
            {type: STRING, value: timestamp},
            authors,
            orgs,
            {type: STRING, value: "ifcjs/web-ifc-api"},
            {type: STRING, value: "ifcjs/web-ifc-api"},
            auth,
        ]);
        this.wasmModule.WriteHeaderLine(result,FILE_SCHEMA,[[{type: STRING, value: model.schema}]]);

        return result;
    }

	/**
	 * Saves a model to a Buffer
	 * @param modelID Model ID
	 * @returns Buffer containing the model data
	 */
    SaveModel(modelID: number): Uint8Array {
        let modelSize = this.wasmModule.GetModelSize(modelID);
        const headerBytes = 512;
        let dataBuffer = new Uint8Array(modelSize + headerBytes);
        let size = 0; 
        this.wasmModule.SaveModel(modelID, (srcPtr: number, srcSize: number) => {
            let src = this.wasmModule.HEAPU8.subarray(srcPtr, srcPtr + srcSize);
            size = srcSize;
            dataBuffer.set(src, 0);
        });
        //shrink down to size
        let newBuffer = new Uint8Array(size);
        newBuffer.set(dataBuffer.subarray(0,size),0);
        return newBuffer;
    }

    /**
     * Export a model to IFC
     * @param modelID model ID
     * @returns blob with mimetype application/x-step containing the model data 
     * 
     * @deprecated Use SaveModel instead
     */
    ExportFileAsIFC(modelID: number) {
        Log.warn("ExportFileAsIFC is deprecated, use SaveModel instead");
        return this.SaveModel(modelID);
    }
    
    /**
    * Retrieves the geometry of an element
    * @param modelID Model handle retrieved by OpenModel
    * @param geometryExpressID express ID of the element
    * @returns Geometry of the element as a list of vertices and indices
    */
    GetGeometry(modelID: number, geometryExpressID: number): IfcGeometry {
        return this.wasmModule.GetGeometry(modelID, geometryExpressID);
    }

    /**
     * Gets the header information required by the user
     * @param modelID Model handle retrieved by OpenModel
     * @param headerType Type of header data you want to retrieve
     * ifc.FILE_NAME, ifc.FILE_DESCRIPTION or ifc.FILE_SCHEMA
     * @returns An object with parameters ID, type and arguments
     */
    GetHeaderLine(modelID: number, headerType: number) {
        return this.wasmModule.GetHeaderLine(modelID, headerType);
    }

    /**
     * Gets the list of all ifcTypes contained in the model
     * @param modelID Model handle retrieved by OpenModel
     * @returns Array of objects containing typeID and typeName
     */
    GetAllTypesOfModel(modelID: number): ifcType[] {
        let typesNames: ifcType[] = [];
        const elements = Object.keys(FromRawLineData[this.modelSchemaList[modelID]]).map((e) => parseInt(e));
        for (let i = 0; i < elements.length; i++) {
            const lines = this.GetLineIDsWithType(modelID, elements[i]);
            if (lines.size() > 0) typesNames.push({ typeID: elements[i], typeName: this.wasmModule.GetNameFromTypeCode(elements[i]) });
        }
        return typesNames;
    }

	/**
	 * Gets the ifc line data for a given express ID
	 * @param modelID Model handle retrieved by OpenModel
	 * @param expressID express ID of the line
	 * @param flatten recursively flatten the line, default false
	 * @param inverse get the inverse properties of the line, default false
	 * @returns lineObject
	 */
    GetLine(modelID: number, expressID: number, flatten = false, inverse = false) {
        let expressCheck = this.wasmModule.ValidateExpressID(modelID, expressID);
        if (!expressCheck) {
            return;
        }

        let rawLineData = this.GetRawLineData(modelID, expressID);
        let lineData = FromRawLineData[this.modelSchemaList[modelID]][rawLineData.type](rawLineData.ID,rawLineData.arguments);

        if (flatten) {
            this.FlattenLine(modelID, lineData);
        }

        let inverseData = InversePropertyDef[this.modelSchemaList[modelID]][rawLineData.type];
        if (inverse && inverseData != null) 
        {
          for (let inverseProp of inverseData) 
          {
            if (!inverseProp[3]) lineData[inverseProp[0]] = null;
            else lineData[inverseProp[0]] = [];
            
            let targetTypes = [inverseProp[1]];
            if (typeof InheritanceDef[this.modelSchemaList[modelID]][inverseProp[1]] != "undefined")
            {
              targetTypes=targetTypes.concat(InheritanceDef[this.modelSchemaList[modelID]][inverseProp[1]]);
            }
            let inverseIDs = this.wasmModule.GetInversePropertyForItem(modelID, expressID, targetTypes, inverseProp[2], inverseProp[3]);
            if (!inverseProp[3] && inverseIDs.size()>0) 
            {
              if (!flatten) lineData[inverseProp[0]] = { type: 5,  value: inverseIDs.get(0) };
              else lineData[inverseProp[0]] = this.GetLine(modelID, inverseIDs.get(0));
            }
            else 
            {
                for (let x = 0; x < inverseIDs.size(); x++) {
                  if (!flatten) lineData[inverseProp[0]].push({ type: 5,  value: inverseIDs.get(x) });
                  else lineData[inverseProp[0]].push(this.GetLine(modelID, inverseIDs.get(x)));
                }
            }
          }
        }
        return lineData;
    }

    /**
     * Gets the next unused expressID
     * @param modelID Model handle retrieved by OpenModel
     * @param expressID Starting expressID value 
     * @returns The next unused expressID starting from the value provided
     */
    GetNextExpressID(modelID: number, expressID: number): number {
        return this.wasmModule.GetNextExpressID(modelID, expressID);
    }

    /**
     * Gets the errors generated by the parser
     * @param modelID Model handle retrieved by OpenModel
     * @returns Vector containing the list of errors
     */
    GetAndClearErrors(modelID: number): Vector<LoaderError> {
        return this.wasmModule.GetAndClearErrors(modelID);
    }

    /**
     * Creates a new entity in the step-file definition
     * @param modelID Model handle retrieved by OpenModel
     * @param type id of the type to add
     * @param args Arguments required by the entity
     * @returns ExpressID of the new entity
     */
    CreateIfcEntity(modelID: number, type:number, ...args: any[] ): IfcLineObject
    {
        let expressID: number = this.IncrementMaxExpressID(modelID, 1);
        return Constructors[this.modelSchemaList[modelID]][type](expressID,args);
    }

    CreateIfcType(modelID: number, type:number, value: any) 
    {
        return TypeInitialisers[this.modelSchemaList[modelID]][type](value);
    }

    GetNameFromTypeCode(type:number): string 
    {
       return this.wasmModule.GetNameFromTypeCode(type);
    }

    IsIfcElement(type:number) : boolean
    {
        return this.wasmModule.IsIfcElement(type);
    }

    GetIfcEntityList(modelID: number) : Array<number>
    {
        return Object.keys(FromRawLineData[this.modelSchemaList[modelID]]).map(x=>parseInt(x));
    }

	/**
	 * Writes a line to the model, can be used to write new lines or to update existing lines
	 * @param modelID model ID
	 * @param lineObject line object to write
	 */
    WriteLine<Type extends IfcLineObject>(modelID: number, lineObject: Type) {
        let property: keyof Type;
        for (property in lineObject)
        {
            const lineProperty: any = lineObject[property];
            if (lineProperty  && (lineProperty as IfcLineObject).expressID !== undefined) {
                // this is a real object, we have to write it as well and convert to a handle
                // TODO: detect if the object needs to be written at all, or if it's unchanged
                this.WriteLine(modelID, lineProperty as IfcLineObject);

                // overwrite the reference
                // NOTE: this modifies the parameter
                (lineObject[property] as any)= new Handle((lineProperty as IfcLineObject).expressID);
            }
            else if (Array.isArray(lineProperty) && lineProperty.length > 0) {
                for (let i = 0; i < lineProperty.length; i++) {
                    if ((lineProperty[i] as IfcLineObject).expressID !== undefined) {
                        // this is a real object, we have to write it as well and convert to a handle
                        // TODO: detect if the object needs to be written at all, or if it's unchanged
                        this.WriteLine(modelID, lineProperty[i] as IfcLineObject);

                        // overwrite the reference
                        // NOTE: this modifies the parameter
                        ((lineObject[property]as any)[i] as any) = new Handle((lineProperty[i] as IfcLineObject).expressID);
                    }
                }
            }
        }
        
        if(lineObject.expressID === undefined || lineObject.expressID < 0) {
            lineObject.expressID = this.IncrementMaxExpressID(modelID, 1);
        }


        let rawLineData: RawLineData = {
            ID: lineObject.expressID,
            type: lineObject.type,
            arguments: ToRawLineData[this.modelSchemaList[modelID]][lineObject.type](lineObject) as any[]
        }
        this.WriteRawLineData(modelID, rawLineData);
    }

	/**
	 * Recursively flattens a line object
	 * @param modelID model ID
	 * @param line line object to flatten
	 */
    FlattenLine(modelID: number, line: any) {
        Object.keys(line).forEach(propertyName => {
            let property = line[propertyName];
            if (property && property.type === 5) {
                if (property.value) line[propertyName] = this.GetLine(modelID, property.value, true);
            }
            else if (Array.isArray(property) && property.length > 0 && property[0].type === 5) {
                for (let i = 0; i < property.length; i++) {
                    if (property[i].value) line[propertyName][i] = this.GetLine(modelID, property[i].value, true);
                }
            }
        });
    }

    GetRawLineData(modelID: number, expressID: number): RawLineData {
        return this.wasmModule.GetLine(modelID, expressID) as RawLineData;
    }

    WriteRawLineData(modelID: number, data: RawLineData) {
        this.wasmModule.WriteLine(modelID, data.ID, data.type, data.arguments);
    }

	/**
	 * Get all line IDs of a specific ifc type
	 * @param modelID model ID
	 * @param type ifc type, @see IfcEntities
	 * @param includeInherited if true, also returns all inherited types 
	 * @returns vector of line IDs
	 */
    GetLineIDsWithType(modelID: number, type: number, includeInherited: boolean = false): Vector<number> {
        let types: Array<number> = [];
        types.push(type);
        if (includeInherited && typeof InheritanceDef[this.modelSchemaList[modelID]][type] != "undefined")
        {
          types = types.concat(InheritanceDef[this.modelSchemaList[modelID]][type]);
        } 
        return this.wasmModule.GetLineIDsWithType(modelID, types);
    }

	/**
	 * Get all line IDs of a model
	 * @param modelID model ID
	 * @returns vector of all line IDs
	 */
    GetAllLines(modelID: Number): Vector<number> {
        return this.wasmModule.GetAllLines(modelID);
    }

	/**
	 * Set the transformation matrix
	 * @param modelID model ID
	 * @param transformationMatrix transformation matrix, flat 4x4 matrix as array[16] 
	 */
    SetGeometryTransformation(modelID: number, transformationMatrix: Array<number>) {
        if (transformationMatrix.length != 16) {
            throw new Error(`invalid matrix size: ${transformationMatrix.length}`);
        }
        this.wasmModule.SetGeometryTransformation(modelID, transformationMatrix);
    }

	/**
	 * Get the coordination matrix
	 * @param modelID model ID
	 * @returns flat 4x4 matrix as array[16]
	 */
    GetCoordinationMatrix(modelID: number): Array<number> {
        return this.wasmModule.GetCoordinationMatrix(modelID) as Array<number>;
    }

    GetVertexArray(ptr: number, size: number): Float32Array {
        return this.getSubArray(this.wasmModule.HEAPF32, ptr, size);
    }

    GetIndexArray(ptr: number, size: number): Uint32Array {
        return this.getSubArray(this.wasmModule.HEAPU32, ptr, size);
    }

    getSubArray(heap: any, startPtr: number, sizeBytes: number) {
        return heap.subarray(startPtr / 4, startPtr / 4 + sizeBytes).slice(0);
    }

    /**
     * Closes a model and frees all related memory
     * @param modelID Model handle retrieved by OpenModel, model must not be closed
    */
    CloseModel(modelID: number) {
        this.ifcGuidMap.delete(modelID);
        this.wasmModule.CloseModel(modelID);
    }

	/**
	 * Streams all meshes of a model
	 * @param modelID Model handle retrieved by OpenModel
	 * @param meshCallback callback function that is called for each mesh
	 */
    StreamAllMeshes(modelID: number, meshCallback: (mesh: FlatMesh) => void) {
        this.wasmModule.StreamAllMeshes(modelID, meshCallback);
    }

	/**
	 * Streams all meshes of a model with a specific ifc type
	 * @param modelID Model handle retrieved by OpenModel
	 * @param types types of elements to stream
	 * @param meshCallback callback function that is called for each mesh
	 */
    StreamAllMeshesWithTypes(modelID: number, types: Array<number>, meshCallback: (mesh: FlatMesh) => void) {
        this.wasmModule.StreamAllMeshesWithTypes(modelID, types, meshCallback);
    }

    /**
     * Checks if a specific model ID is open or closed
     * @param modelID Model handle retrieved by OpenModel
	 * @returns true if model is open, false if model is closed
    */
    IsModelOpen(modelID: number): boolean {
        return this.wasmModule.IsModelOpen(modelID);
    }

    /**
     * Load all geometry in a model
     * @param modelID Model handle retrieved by OpenModel
	 * @returns Vector of FlatMesh objects
    */
    LoadAllGeometry(modelID: number): Vector<FlatMesh> {
        return this.wasmModule.LoadAllGeometry(modelID);
    }

    /**
     * Load geometry for a single element
     * @param modelID Model handle retrieved by OpenModel
	 * @param expressID ExpressID of the element
	 * @returns FlatMesh object
    */
    GetFlatMesh(modelID: number, expressID: number): FlatMesh {
        return this.wasmModule.GetFlatMesh(modelID, expressID);
    }

    /**
         * Returns the maximum ExpressID value in the IFC file, ex.- #9999999
         * @param modelID Model handle retrieved by OpenModel
         * @returns Express numerical value
         */
    GetMaxExpressID(modelID: number) {
        return this.wasmModule.GetMaxExpressID(modelID);
    }

    /**
         * Returns the maximum ExpressID value in the IFC file after incrementing the maximum ExpressID by the increment size, ex.- #9999999
         * @param modelID Model handle retrieved by OpenModel
         * @param incrementSize The value to add to the max ExpressID for the new max ExpressID
         * @returns ExpressID numerical value
         */
    IncrementMaxExpressID(modelID: number, incrementSize: number) {
        return this.wasmModule.IncrementMaxExpressID(modelID, incrementSize);
    }

    /**
         * Returns the type of a given ifc entity in the fiule.
         * @param modelID Model handle retrieved by OpenModel
         * @param expressID Line Number
         * @returns IFC Type Code
         */

    GetLineType(modelID: number, expressID: number) {
        return this.wasmModule.GetLineType(modelID, expressID);
    }

    /**
     * Creates a map between element ExpressIDs and GlobalIDs.
     * Each element has two entries, (ExpressID -> GlobalID) and (GlobalID -> ExpressID).
     * @param modelID Model handle retrieved by OpenModel
     */
    CreateIfcGuidToExpressIdMapping(modelID: number): void {
        const map = new Map<string | number, string | number>();
        let entities = this.GetIfcEntityList(modelID);
        for (const typeId of entities) {
            const lines = this.GetLineIDsWithType(modelID, typeId);
            const size = lines.size();
            for (let y = 0; y < size; y++) {
                const expressID = lines.get(y);
                const info = this.GetLine(modelID, expressID);
                if (info.GlobalId == null) {
                    continue;
                }
                const globalID = info.GlobalId.value;
                map.set(expressID, globalID);
                map.set(globalID, expressID);
            }
        }
        this.ifcGuidMap.set(modelID, map);
    }

	/**
	 * Sets the path to the wasm file
	 * @param path path to the wasm file
	 * @param absolute if true, path is absolute, otherwise it is relative to executing script
	 */
    SetWasmPath(path: string, absolute = false) {
        this.wasmPath = path;
        this.isWasmPathAbsolute = absolute;
    }

	/**
	 * Sets the log level
	 * @param level Log level to set
	 */
    SetLogLevel(level: LogLevel): void {
        Log.setLogLevel(level);
        this.wasmModule.SetLogLevel(level);
    }
}
