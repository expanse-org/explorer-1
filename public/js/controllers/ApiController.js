angular.module('BlocksApp').controller('ApiController', function($stateParams, $rootScope, $scope, $http, $location) {
  $scope.form = {};
  $scope.postTx = function(rawTx) {
    $http({
      method: 'POST',
      url: '/web3relay',
      data: {'tx_send': rawTx}
    }).then(function(resp) {
      if (!resp.data.success) {
        $scope.rawTxResponse = resp.data.reason
      } else {
        $scope.rawTxResponse = resp.data.hash
      }
    });
  }
  $scope.$on('$viewContentLoaded', function() {   
      // initialize core components
      App.initAjax();
      //TableAjax.init();
  });

  $rootScope.$state.current.data["pageSubTitle"] = $stateParams.number;
})