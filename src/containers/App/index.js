import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import * as AppActions from './actions';
import { queries, filters, collections } from '../../utils';
import _ from 'underscore';
import Promise from 'bluebird';
import { LIST_SETTINGS_LS_KEY } from './constants';

import Header from '../Header';
import Filters from '../Filters';
import DataList from '../DataList';
import Footer from '../Footer';
import Modal from '../../components/Modal';

// Remove the first load marker,..
// first_load gets used in the app reducer
window.onbeforeunload = function (e) {
  localStorage.removeItem("first_load", "1");
};

let lastItemUpdate;

class App extends Component { // eslint-disable-line react/prefer-stateless-function
  constructor(props) {
    super(props);

    // Kickoff first data load
    this.init(props);

    // Setup the render listener for dipatching items to the store after xhr requests
    this._initRenderer();

    this.state = {
      toggleFilter: false
    }
  }

  componentWillReceiveProps(nextState){
    if(nextState.pushDispatch.Items && nextState.pushDispatch.Items !== lastItemUpdate){
      lastItemUpdate = nextState.pushDispatch.Items;

      this.props.updateItems({
        Items: nextState.pushDispatch.Items,
        count: nextState.pushDispatch.count
      }); 
    }
  }

  /**
   * Init actions
   * props is a main app reducer
   * @param props
   */
  init(props) {
    const { updatePagination, config, dataListConfig, filterChange, appInit, app } = props,
      self = this,
      paginationParams = _.pick(queries.parseParms(queries.readQueryStringFromURL()), ['skip', 'take', 'page']),
      nonPaginationParams = Object.keys(_.omit(queries.parseParms(queries.readQueryStringFromURL()), ['skip', 'take', 'page', ""]));

    appInit({ config: dataListConfig });

    /**
     * Check the hooks for onInit
     */
    if (dataListConfig.hooks && dataListConfig.hooks.onInit) {

      /**
       * One last config check. Set the config as soon as we get it but allow a 
       * preferences object to be passed in.
       */
      const onInit = dataListConfig.hooks.onInit(app, dataListConfig);

      /**
       * do a fn exists check. If a return fn wasn't passed then onInit wil be 
       * undefined and we can move on, otherwise let's pass along the preferences here.
       */
      if (onInit) {
        onInit((preferences = []) => {
          appInit({ preferences });
          _initNext();
        });
      } else {
        _initNext();
      }
    } else {
      _initNext();
    }

    // Encapuslated to allow async nexting
    function _initNext() {

      // Cast the incoming values to int
      const pagination = {
        skip: (paginationParams.skip || 0) * 1,
        take: (paginationParams.take || app.pagination.take) * 1,
        page: (paginationParams.page || 1) * 1,
        id: `dl__items__${dataListConfig.id}`
      };

      let params = {pagination};

      // Used to persist list settings
      let columnPrefs;
      try {columnPrefs = JSON.parse(localStorage.getItem(LIST_SETTINGS_LS_KEY)) }catch(e){};
      if (columnPrefs) { params['preferences'] = columnPrefs; }
      
      appInit(params);// Set the initial pagination from query string read

      // Add the pagination listener
      self._initPaginationChangeListener();

      // Add the programatic filter change hook listener
      self._initBootHooks();

      /** 
      * If the config option was set to allow run of query string on render & if there is a string in the url
      * Filter out pagination params & the view param from our filter query string detection
      */
      //if((dataListConfig.runQueryStringURLOnRender && nonPaginationParams.length > 0)) {
      self._applyQueryStringToFilters({ props, self, pagination });
      // }else{
      // @todo This is wiping out the pagination data on load
      // filterChange([]);//triggers an empty load to load the default dataset. No filters were in url or the config prevents running filter queries
      // }
    }
  }

  /**
   * COnnect any hooks that need to be setup on boot here.
   */
  _initBootHooks() {
    if(this.props.dataListConfig && this.props.dataListConfig.hooks) {
      this._initDoFilterChange();
      this._initDoSort();
    }
  }

   /**
   * Setup the doFilterChange hook for triggering filter changes from the parent app.
   * FilterChange accepts: {id,view,value}
   * 
   * Whenever the doFilterChange callback is run it triggers a filterChange dispatch
   */
  _initDoFilterChange() {
    const { dataListConfig, filterChange } = this.props;

    if(dataListConfig.hooks.doFilterChange){
      dataListConfig.hooks.doFilterChange(filterChange);// pass along the callback
    }
  }

  /**
   * Run sort on the key passed in whenever the hook's callback is triggered.
   */
  _initDoSort() {
    const { dataListConfig, filterChange } = this.props;

    if(dataListConfig.hooks.doSort){
      dataListConfig.hooks.doSort((sortByKey, direction = 'DESC') => { 
        filterChange({
          id: `sort-${sortByKey}`,
          value: direction
        });
      });
    }
  }

  /**
   * Procedure used to Convert the query string to filter values
   */
  _applyQueryStringToFilters(args) {
    return this._readQueryString(args)
      .then(this._makeQueryObjectFromQueryString)
      .then(this._populateFilterArrays);
  }

  /**
   * Read the query string in the address bar
   */
  _readQueryString(args) {
    return new Promise((resolve, reject) => {
      resolve(Object.assign({}, args, { queryString: queries.readQueryStringFromURL() }));
    });
  }

  /**
   * Convert the query string to a query object
   * @param args
   * @private
   */
  _makeQueryObjectFromQueryString(args) {
    return new Promise((resolve, reject) => {
      resolve(Object.assign({}, args, { queryObject: queries.makeQueryObjectFromQueryString(args.queryString) }));
    });
  }

  /**
   * Dispatches to create a new filter for each value present in the query Object
   * @param args
   * @private
   */
  _populateFilterArrays(args) {
    const self = this;

    return new Promise((resolve, reject) => {
      let filterChangeBatch = [];

      const nonPaginationParams = _.omit(args.queryObject, ['skip', 'take', 'page', ""]),
        viewId = _.pick(nonPaginationParams, 'view').view;

      delete nonPaginationParams.view;// Internal use only, no more need to have it included

      _.mapObject(nonPaginationParams, (value, key) => {
        // Took this out to support csv values in query params vals. Our use case was the networks multiselect filter.
        // if (_.isArray(value)) 
        // value.forEach(val => {
        //   filterChangeBatch.push({
        //     id: key,
        //     view: viewId,
        //     value: val
        //   });
        // });
        // } else 
        if (_.isObject(value) && key === 'sort') {
          args.self._sortDispatcher(Object.assign(args, { sort: value }));
        } else {// Handle the sort object
          filterChangeBatch.push({
            id: key,
            view: viewId,
            value
          });
        }
      });

      args.props.filterChange(filterChangeBatch);
      args.props.appInit({
        pagination: args.pagination,
        queryObject: args.queryObject,
        queryString: args.queryString
      });
      resolve(Object.assign({}, args));
    });
  }

  /**
   * Handles dynamically dispatching to the store by building objects based on our config file
   * @param args
   * @param key
   * @param value
   * @private
   */
  _filterDispatchBuilder(args, key, value, viewId) {
    const self = this;
    let filterDispatch = {};

    // Loop through the views, filter groups & child filters until we find our id.
    //Dispatch the filter as a normal change
    self.props.app.views.forEach(view => {
      if (viewId === view.id) {
        view.filterGroups.forEach(group => {
          group.filters.forEach(filter => {

            // Dispatch only when we have found our filter by value.
            // Special handling of constant for date filters
            if (filter.id === key) {
              filterDispatch = {
                id: key,
                view: viewId,
                value
              };
            }
          });
        });
      }
    });

    return filterDispatch;
  }

  /**
   * Does a mapping of the id to the particular default.
   * Runs when a url is producing the filter configuration
   * @param def
   * @param entityUUID
   * @param dataSources
   * @private
   */
  _lookupLabelByID(def, entityUUID, dataSources) {
    const entity = _.findWhere(dataSources[def], { entityUUID });
    return typeof entity === 'undefined' ? def : entity.entityValue;
  }

  /**
   * Dispatches for sort items
   * @param args
   * @private
   */
  _sortDispatcher(args) {
    //_.mapObject(args.sort,(value,key)=>{
    //
    //    // Run through the sort items
    //    args.props.options.sort.by.forEach(sortItem=>{
    //
    //        // Dispatch only when we have found our filter by value.
    //        // SPecial handling of constant for date filters
    //        if(sortItem.id === key){
    //
    //            // Action CONSTANT is created by filter ui type ie. select,date,checkbox,link
    //            let CONSTANT = `SORT_CHANGE`;
    //
    //            // Dispatch an action
    //            args.props.setFilter({
    //                type:CONSTANT,
    //                data:{
    //                    id:sortItem.id,
    //                    label:sortItem.label,//get the value of the selected item
    //                    instanceType : 'sort',
    //                    value
    //                }
    //            });
    //        }
    //    });
    //});
  }

  /**
   * Handle listening for pagination events
   * @private
   */
  _initPaginationChangeListener() {
    const { app, config, dataListConfig, appInit } = this.props,
      self = this;

    return new Promise((resolve, reject) => {
      const elem = document;

      elem.addEventListener('paginationChange', function (e) {
        const event = e.data;

        // Only run if we are filtering dataTable items & there are items in the queryObject
        if (event.id === `dl__items__${dataListConfig.id}`) {

          // Need to update the store here
          self.loadNextPage(event)
            .then(res => {
              // Update the redux store to keep everything in sync
              appInit({ pagination: e.data });

              /**
               * The pagination component update is set by the
               * xhr request response in utils.js makeXHRRequest func
               */
            });
        }
      });
    });
  }

  /**
   * Listen for filter xhr list item data to be returned from the app
   * @private
   */
  _initRenderer() {
    const { updateItems, dataListConfig } = this.props;
    const elem = document;

    // ENtry point for list data pushes originating from the parent app.
    if (dataListConfig && dataListConfig.hooks && dataListConfig.hooks.pushDispatch) {
      dataListConfig.hooks.pushDispatch(updateItems);
    }

    elem.addEventListener('renderToStore', function (e) {
      updateItems({
        Items: e.data.Items,
        count: e.data.total
      });
    });
  }

  /**
   * Send a request to run the filters passing the new pagination params but the same queryObject taken from the state tree
   */
  loadNextPage(event) {
    return new Promise((resolve, reject) => {
      const { app } = this.props;

      // Triggers the xhr Request
      filters.run(Object.assign({}, app, { pagination: event }), app.selectedView)
        .then(resolve, reject);
    });
  }

  makeAppBody(app) {
    const filters = this.props.config.showFilters ? (<Filters className={this.state.toggleFilter ? 'dl__filters--open' : ''} />) : '';
      const width = this.props.config.showFilters ? undefined : '100%';
      const toggleClasses = !this.state.toggleFilter ? 'dl__filters--toggle' : 'dl__filters--toggle--open dl__filters--toggle';
      const filtersToggle = this.props.config.showFilters ? (<div className={toggleClasses} onClick={() => this.setState({ toggleFilter: !this.state.toggleFilter })}></div>) : '';

    return (
      <div>
        <Header> </Header>
        <div className="dl__container" >
          {filtersToggle}
          {filters}
          <DataList Items={this.props.pushDispatch.Items || app.Items} width={width}> </DataList>
        </div> 
        <Footer> </Footer>
      </div>
    );
  }

  render() {
    const { config: { selector }, app, modal } = this.props,
      classNames = `dl ${selector}`,
      appBody = Object.keys(app.selectedView).length > 0 ? (this.makeAppBody(app)) : '';//Delay render until config is loaded

    return (
      <div className={classNames} >
        {appBody}
        {modal.show ? <Modal component={modal.Component}/> : ''}
      </div>);
  }
}

//Which part of the Redux global state does our component want to receive as props?
function mapStateToProps(state, ownProps) {
  //console.log('STATE in App/index.js',state,ownProps);
  return {
    config: state.app.config,
    app: state.app,
    modal: state.app.modal
  };
}

function mapDispatchToProps(dispatch) {
  return bindActionCreators(AppActions, dispatch);
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(App);